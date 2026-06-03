import type {LoaderFunctionArgs} from 'react-router';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {unauthenticated} from '../shopify.server';

type Money = {
  amount: string;
  currencyCode: string;
};

type OrderNode = {
  id: string;
  legacyResourceId: string;
  name: string;
  email?: string | null;
  createdAt: string;
  displayFinancialStatus: string;
  statusPageUrl?: string | null;
  totalPriceSet: {
    shopMoney: Money;
  };
  totalOutstandingSet: {
    shopMoney: Money;
  };
  lineItems?: {
    nodes: {
      title: string;
      quantity: number;
      variant?: {
        legacyResourceId: string;
      } | null;
      originalTotalSet: {
        shopMoney: Money;
      };
    }[];
  };
};

type OrdersResponse = {
  data?: {
    customer?: {
      orders?: {
        nodes: OrderNode[];
      };
    };
  };
  errors?: unknown;
};

type CustomerAccountSessionToken = {
  aud: string;
  dest: string;
  exp: number;
  nbf: number;
  sub?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const orderQuery = `
  #graphql
  query GetCustomerOrders($customerId: ID!) {
    customer(id: $customerId) {
      id
      orders(first: 20, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          legacyResourceId
          name
          email
          createdAt
          displayFinancialStatus
          statusPageUrl
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalOutstandingSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 20) {
            nodes {
              title
              quantity
              variant {
                legacyResourceId
              }
              originalTotalSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

function normalizeShopDomain(shop: string) {
  return shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function buildOrderCheckoutUrl(shop: string, order: OrderNode) {
  const cartLines = (order.lineItems?.nodes ?? [])
    .filter((item) => item.variant?.legacyResourceId)
    .map((item) => `${item.variant?.legacyResourceId}:${item.quantity}`);

  if (cartLines.length === 0) {
    return null;
  }

  return `https://${shop}/cart/${cartLines.join(',')}?checkout`;
}

function buildSufioInvoiceUrl(shop: string, order: OrderNode, path: string) {
  const orderNumber = order.name.replace(/^#/, '');
  const params = new URLSearchParams({
    id: order.legacyResourceId,
    number: orderNumber,
  });

  return `https://${shop}${path}?${params.toString()}`;
}

function moneyAmount(value: string) {
  return Number.parseFloat(value) || 0;
}

function formatMoney(currencyCode: string, amount: number) {
  return `${currencyCode} ${amount.toFixed(2)}`;
}

function daysSince(date: string) {
  const createdAt = new Date(date).getTime();
  const today = Date.now();
  const millisecondsPerDay = 1000 * 60 * 60 * 24;

  return Math.max(0, Math.floor((today - createdAt) / millisecondsPerDay));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function decodeJwtPart(token: string, part: number) {
  try {
    const segment = token.split('.')[part];

    if (!segment) {
      return null;
    }

    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function isSignedWithAppSecret(token: string): boolean {
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const [header, payload, signature] = token.split('.');

  if (!apiSecret || !header || !payload || !signature) {
    return false;
  }

  const expectedSignature = createHmac('sha256', apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  const expected = Buffer.from(expectedSignature);
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function verifyCustomerAccountToken(token: string): CustomerAccountSessionToken {
  const payload = decodeJwtPart(token, 1) as CustomerAccountSessionToken | null;
  const now = Math.floor(Date.now() / 1000);
  const clockTolerance = 60;

  if (!isSignedWithAppSecret(token)) {
    throw new Error('The session token signature does not match the app secret.');
  }

  if (!payload) {
    throw new Error('The session token payload could not be decoded.');
  }

  if (payload.aud !== process.env.SHOPIFY_API_KEY) {
    throw new Error('The session token belongs to a different Shopify app.');
  }

  if (payload.nbf && payload.nbf > now + clockTolerance) {
    throw new Error('The session token is not active yet.');
  }

  if (payload.exp && payload.exp < now - clockTolerance) {
    throw new Error('The session token has expired.');
  }

  return payload;
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function createInvoicePdf(lines: string[]) {
  const content = [
    'BT',
    '/F1 18 Tf',
    '50 760 Td',
    `(${escapePdfText(lines[0] ?? 'Invoice')}) Tj`,
    '/F1 11 Tf',
    ...lines.slice(1).flatMap((line) => [
      '0 -20 Td',
      `(${escapePdfText(line)}) Tj`,
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf);
}

export async function action() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function loader({request}: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const authorizationHeader = request.headers.get('authorization');
  const token = authorizationHeader?.replace('Bearer ', '');

  if (!authorizationHeader) {
    return Response.json(
      {error: 'No customer account session token was sent to the app.'},
      {
        status: 401,
        headers: corsHeaders,
      },
    );
  }

  console.log('Invoice request authorization header', {
    hasBearerToken: authorizationHeader.startsWith('Bearer '),
    tokenLength: token?.length,
    signatureMatchesAppSecret: token ? isSignedWithAppSecret(token) : false,
  });

  let sessionToken: CustomerAccountSessionToken;

  try {
    sessionToken = verifyCustomerAccountToken(token ?? '');
  } catch (error) {
    console.error('Customer account session verification failed', error);

    return Response.json(
      {
        error: `The customer account session token could not be verified: ${errorMessage(
          error,
        )}`,
      },
      {
        status: 401,
        headers: corsHeaders,
      },
    );
  }

  const customerId = sessionToken.sub?.split('/').at(-1);
  const customerGid = sessionToken.sub;
  const shop = normalizeShopDomain(sessionToken.dest);

  console.log('Invoice request session', {
    shop,
    customerId,
    hasCustomer: Boolean(customerId),
  });

  if (!customerId) {
    return Response.json(
      {error: 'A logged-in customer is required to load invoices.'},
      {
        status: 401,
        headers: corsHeaders,
      },
    );
  }

  let admin;

  try {
    const context = await unauthenticated.admin(shop);
    admin = context.admin;
  } catch (error) {
    console.error('Unable to create Admin API client for invoices', error);

    return Response.json(
      {
        error: `Could not connect to Shopify Admin for ${shop}: ${errorMessage(
          error,
        )}`,
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  let result: OrdersResponse;

  try {
    const response = await admin.graphql(orderQuery, {
      variables: {
        customerId: customerGid,
      },
    });
    result = (await response.json()) as OrdersResponse;
  } catch (error) {
    console.error('Unable to fetch invoice orders', error);

    return Response.json(
      {error: `Could not fetch orders: ${errorMessage(error)}`},
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  if (result.errors) {
    return Response.json(
      {error: result.errors},
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  const orderNodes = result.data?.customer?.orders?.nodes ?? [];
  const url = new URL(request.url);
  const downloadOrderId = url.searchParams.get('downloadOrderId');

  console.log('Invoice order query result', {
    shop,
    customerId,
    orderCount: orderNodes.length,
  });

  if (downloadOrderId) {
    const order = orderNodes.find((node) => node.id === downloadOrderId);

    if (!order) {
      return Response.json(
        {error: 'Invoice not found for this customer.'},
        {
          status: 404,
          headers: corsHeaders,
        },
      );
    }

    const amount = order.totalPriceSet.shopMoney;
    const balance = order.totalOutstandingSet.shopMoney;
    const lines = [
      `Invoice ${order.name}`,
      `Date: ${order.createdAt.slice(0, 10)}`,
      `Status: ${order.displayFinancialStatus}`,
      `Amount: ${amount.currencyCode} ${amount.amount}`,
      `Balance: ${balance.currencyCode} ${balance.amount}`,
      '',
      'Items:',
      ...(order.lineItems?.nodes ?? []).map((item) => {
        const lineAmount = item.originalTotalSet.shopMoney;

        return `${item.quantity} x ${item.title} - ${lineAmount.currencyCode} ${lineAmount.amount}`;
      }),
      '',
    ];

    const pdf = createInvoicePdf(lines);

    return new Response(pdf, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${order.name.replace(
          /[^a-z0-9-_]/gi,
          '',
        )}.pdf"`,
      },
    });
  }

  const invoices = orderNodes.map((order) => {
    const amount = order.totalPriceSet.shopMoney;
    const balance = order.totalOutstandingSet.shopMoney;
    const isPaid = ['PAID', 'VOIDED'].includes(
      String(order.displayFinancialStatus).toUpperCase(),
    );
    const balanceAmount = moneyAmount(balance.amount).toFixed(2);
    const checkoutUrl = isPaid ? null : buildOrderCheckoutUrl(shop, order);

    return {
      id: order.id,
      legacyResourceId: order.legacyResourceId,
      type: 'Invoice',
      number: order.name,
      poNumber: '',
      date: order.createdAt.slice(0, 10),
      status: order.displayFinancialStatus,
      amount: `${amount.currencyCode} ${amount.amount}`,
      balance: `${balance.currencyCode} ${balanceAmount}`,
      products: (order.lineItems?.nodes ?? []).map((item) => item.title),
      statusPageUrl: order.statusPageUrl,
      checkoutUrl,
      sufioViewUrl: buildSufioInvoiceUrl(shop, order, '/apps/sufio/invoice/'),
      sufioDownloadUrl: buildSufioInvoiceUrl(
        shop,
        order,
        '/apps/sufio/invoice/download/',
      ),
    };
  });

  const aging = orderNodes.reduce(
    (totals, order) => {
      const amount = moneyAmount(order.totalPriceSet.shopMoney.amount);
      const age = daysSince(order.createdAt);

      if (age <= 30) {
        totals.days30 += amount;
      } else if (age <= 60) {
        totals.days31to60 += amount;
      } else if (age <= 90) {
        totals.days61to90 += amount;
      }

      return totals;
    },
    {
      days61to90: 0,
      days31to60: 0,
      days30: 0,
    },
  );
  const currencyCode =
    orderNodes[0]?.totalPriceSet.shopMoney.currencyCode ?? 'AUD';
  const totalBalance =
    aging.days61to90 + aging.days31to60 + aging.days30;

  return Response.json(
    {
      aging: {
        days61to90: formatMoney(currencyCode, aging.days61to90),
        days31to60: formatMoney(currencyCode, aging.days31to60),
        days30: formatMoney(currencyCode, aging.days30),
        total: formatMoney(currencyCode, totalBalance),
      },
      invoices,
    },
    {
      headers: corsHeaders,
    },
  );
}

