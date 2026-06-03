import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const BACKEND_URL =
  "https://invoice-tab-shopify.vercel.app/api/invoices";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [data, setData] = useState({
    aging: {
      days61to90: '$0.00',
      days31to60: '$0.00',
      days30: '$0.00',
      total: '$0.00',
    },
    invoices: [],
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    async function loadInvoices() {
      try {
        setError('');
        const token = await shopify.sessionToken.get();

        const response = await fetch(BACKEND_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const invoiceData = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof invoiceData.error === 'string'
              ? invoiceData.error
              : `Invoice request failed with ${response.status}`,
          );
        }

        setData(invoiceData);
      } catch (error) {
        console.error('Failed to load invoices', error);
        setError(
          error instanceof Error ? error.message : 'Failed to load invoices',
        );
      } finally {
        setLoading(false);
      }
    }

    loadInvoices();
  }, []);

  function getBalanceValue(invoice) {
    return Number(String(invoice.balance).replace(/[^\d.]/g, '')) || 0;
  }

  function canPayInvoice(invoice) {
    const status = String(invoice.status).toUpperCase();

    return getBalanceValue(invoice) > 0 && !['PAID', 'VOIDED'].includes(status);
  }

  function invoiceMatchesSearch(invoice) {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return [
      invoice.type,
      invoice.number,
      invoice.poNumber,
      invoice.status,
      invoice.amount,
      invoice.balance,
      ...(invoice.products ?? []),
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  }

  function invoiceMatchesDateRange(invoice) {
    if (fromDate && invoice.date < fromDate) {
      return false;
    }

    if (toDate && invoice.date > toDate) {
      return false;
    }

    return true;
  }

  const filteredInvoices = data.invoices.filter((invoice) => {
    return invoiceMatchesSearch(invoice) && invoiceMatchesDateRange(invoice);
  });
  const hasActiveFilters =
    searchQuery.trim() !== '' || fromDate !== '' || toDate !== '';
  const shouldShowNoFilterMatch =
    hasActiveFilters && data.invoices.length > 0 && filteredInvoices.length === 0;

  function getInputValue(event) {
    return event.target?.value || '';
  }

  function viewInvoice(invoice) {
    navigation.navigate(
      invoice.sufioViewUrl ||
        invoice.statusPageUrl ||
        `/orders/${invoice.legacyResourceId}`,
    );
  }

  async function downloadInvoice(invoice) {
    if (invoice.sufioDownloadUrl) {
      navigation.navigate(invoice.sufioDownloadUrl);
      return;
    }

    const token = await shopify.sessionToken.get();
    const url = `${BACKEND_URL}?downloadOrderId=${encodeURIComponent(invoice.id)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      shopify.toast.show('Invoice download is not available');
      return;
    }

    navigation.navigate(url);
  }

  function payInvoice(invoice) {
    if (!canPayInvoice(invoice)) {
      shopify.toast.show('This invoice has no balance due');
      return;
    }

    if (!invoice.checkoutUrl) {
      shopify.toast.show('Checkout is not available for this invoice');
      return;
    }

    navigation.navigate(invoice.checkoutUrl);
  }

  if (loading) {
    return (
      <s-page heading="Invoices">
        <s-text>Loading invoices...</s-text>
      </s-page>
    );
  }

  if (error) {
    return (
      <s-page heading="Invoices">
        <s-banner tone="critical" heading="Invoices could not be loaded">
          <s-text>{error}</s-text>
        </s-banner>
      </s-page>
    );
  }

  return (
    <s-page heading="Invoices">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
          <InvoiceSummaryCard
            label="61-90 DAYS"
            value={data.aging.days61to90}
          />
          <InvoiceSummaryCard
            label="31-60 DAYS"
            value={data.aging.days31to60}
          />
          <InvoiceSummaryCard label="30 DAYS" value={data.aging.days30} />
          <InvoiceSummaryCard label="TOTAL" value={data.aging.total} />
        </s-grid>

        <s-grid gridTemplateColumns="2fr 1fr 1fr" gap="base">
          <s-text-field
            label="Search product or invoice number"
            value={searchQuery}
            onInput={(event) => setSearchQuery(getInputValue(event))}
          />
          <s-date-field
            label="From Date"
            value={fromDate}
            onInput={(event) => setFromDate(getInputValue(event))}
          />
          <s-date-field
            label="To Date"
            value={toDate}
            onInput={(event) => setToDate(getInputValue(event))}
          />
        </s-grid>

        <s-section>
          <s-grid
            gridTemplateColumns="1fr 1fr 2fr 1fr 1fr 1fr 1fr 0.5fr 0.5fr 0.5fr"
            gap="base"
          >
            <s-text type="strong">Type</s-text>
            <s-text type="strong">Number</s-text>
            <s-text type="strong">PO Number</s-text>
            <s-text type="strong">Date</s-text>
            <s-text type="strong">Status</s-text>
            <s-text type="strong">Amount</s-text>
            <s-text type="strong">Balance</s-text>
            <s-text type="strong">View</s-text>
            <s-text type="strong">Download</s-text>
            <s-text type="strong">Pay</s-text>

            {shouldShowNoFilterMatch && <s-text>No invoice match</s-text>}

            {filteredInvoices.map((invoice) => (
              <>
                <s-text>{invoice.type}</s-text>
                <s-text>{invoice.number}</s-text>
                <s-text>{invoice.poNumber}</s-text>
                <s-text>{invoice.date}</s-text>
                <s-text>{invoice.status}</s-text>
                <s-text>{invoice.amount}</s-text>
                <s-text>{invoice.balance}</s-text>
                <s-button onClick={() => viewInvoice(invoice)}>View</s-button>
                <s-button onClick={() => downloadInvoice(invoice)}>
                  Download
                </s-button>
                <s-button
                  variant="primary"
                  disabled={!canPayInvoice(invoice)}
                  onClick={() => payInvoice(invoice)}
                >
                  Pay
                </s-button>
              </>
            ))}
          </s-grid>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function InvoiceSummaryCard({label, value}) {
  return (
    <s-section>
      <s-stack gap="small">
        <s-text>{label}</s-text>
        <s-divider />
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-section>
  );
}
