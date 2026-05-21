import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const BACKEND_URL =
  'https://malpractice-address-skirts-casa.trycloudflare.com/api/invoices';

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

  useEffect(() => {
    async function loadInvoices() {
      try {
        const token = await shopify.sessionToken.get();

        const response = await fetch(BACKEND_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const invoiceData = await response.json();
        setData(invoiceData);
      } catch (error) {
        console.error('Failed to load invoices', error);
      } finally {
        setLoading(false);
      }
    }

    loadInvoices();
  }, []);

  if (loading) {
    return (
      <s-page heading="Invoices">
        <s-text>Loading invoices...</s-text>
      </s-page>
    );
  }

  return (
    <s-page heading="Invoices">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
          <InvoiceSummaryCard label="61-90 DAYS" value={data.aging.days61to90} />
          <InvoiceSummaryCard label="31-60 DAYS" value={data.aging.days31to60} />
          <InvoiceSummaryCard label="30 DAYS" value={data.aging.days30} />
          <InvoiceSummaryCard label="TOTAL" value={data.aging.total} />
        </s-grid>

        <s-grid gridTemplateColumns="2fr 1fr 1fr" gap="base">
          <s-text-field label="Search product or invoice number" />
          <s-text-field label="From Date" />
          <s-text-field label="To Date" />
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

            {data.invoices.map((invoice) => (
              <>
                <s-text>{invoice.type}</s-text>
                <s-text>{invoice.number}</s-text>
                <s-text>{invoice.poNumber}</s-text>
                <s-text>{invoice.date}</s-text>
                <s-text>{invoice.status}</s-text>
                <s-text>{invoice.amount}</s-text>
                <s-text>{invoice.balance}</s-text>
                <s-button>View</s-button>
                <s-button>Download</s-button>
                <s-button variant="primary">Pay</s-button>
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