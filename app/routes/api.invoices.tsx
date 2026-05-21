import type {LoaderFunctionArgs} from 'react-router';
import {authenticate, unauthenticated} from '../shopify.server';

type Money = {
  amount: string;
  currencyCode: string;
};

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  totalPriceSet: {
    shopMoney: Money;
  };
  currentTotalPriceSet: {
    shopMoney: Money;
  };
};

type OrdersResponse = {
  data?: {
    orders?: {
      nodes: OrderNode[];
    };
  };
  errors?: unknown;
};

export async function loader({request}: LoaderFunctionArgs) {
  const {sessionToken, cors} = await authenticate.public.customerAccount(
    request,
  );
  const customerId = sessionToken.sub?.split('/').at(-1);

  if (!customerId) {
    return cors(
      Response.json(
        {error: 'A logged-in customer is required to load invoices.'},
        {status: 401},
      ),
    );
  }

  const {admin} = await unauthenticated.admin(sessionToken.dest);

  const response = await admin.graphql(
    `
      #graphql
      query GetOrders($query: String) {
        orders(first: 20, sortKey: CREATED_AT, reverse: true, query: $query) {
          nodes {
            id
            name
            createdAt
            displayFinancialStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        query: `customer_id:${customerId}`,
      },
    },
  );

  const result = (await response.json()) as OrdersResponse;

  if (result.errors) {
    return cors(Response.json({error: result.errors}, {status: 500}));
  }

  const invoices = (result.data?.orders?.nodes ?? []).map((order) => {
    const amount = order.totalPriceSet.shopMoney;
    const balance = order.currentTotalPriceSet.shopMoney;

    return {
      type: 'Invoice',
      number: order.name,
      poNumber: '',
      date: order.createdAt.slice(0, 10),
      status: order.displayFinancialStatus,
      amount: `${amount.currencyCode} ${amount.amount}`,
      balance: `${balance.currencyCode} ${balance.amount}`,
    };
  });

  const totalBalance = invoices.reduce((sum, invoice) => {
    return sum + Number(invoice.balance.replace(/[^\d.]/g, ''));
  }, 0);

  return cors(
    Response.json({
      aging: {
        days61to90: '$0.00',
        days31to60: '$0.00',
        days30: '$0.00',
        total: `$${totalBalance.toFixed(2)}`,
      },
      invoices,
    }),
  );
}
