const fetch = require('node-fetch');
const { google } = require('googleapis');
const { GoogleAuth } = require('googleapis').auth;

// API Keys and Configuration
const BOUNCER_API_KEY = '9CbCfpDobw6Patquus2OwCSXdIXDRuK82M9spUan';
const ITERABLE_API_KEY = '50bbcd361434491eb1208156904fb76e';
const ITERABLE_LIST_ID = 'TP'; // Iterable email list
const PTR_WEBHOOK_URL = 'https://pro.ptrtrk.com/RpeLOf?utm_source=tpnew&email=';

// Google Sheets Configuration
const SPREADSHEET_ID = '1syVupXmoT69HFoKtNq_d68hDhP-l2WGQEETc172WPfY';
const SHEET_NAME = 'Sheet1'; // Update if your sheet name is different

// Initialize Google Sheets API client
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// Helper function to append email to the correct Google Sheets column
async function appendRow(email, category) {
  const row = [
    category === 'deliverable' ? email : '',
    category === 'risky' ? email : '',
    category === 'undeliverable' ? email : '',
    category === 'unknown' ? email : ''
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
}

// Main API handler function
exports.handler = async function(event, context) {
  try {
    // ✅ Step 1: Get the email from request
    const email = event.queryStringParameters && event.queryStringParameters.email;
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email parameter' }) };
    }

    console.log(`Verifying email: ${email}`);

    // ✅ Step 2: Verify the email with Bouncer API
    const bouncerRes = await fetch(`https://api.usebouncer.com/v2/email?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${BOUNCER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const bouncerData = await bouncerRes.json();
    const category = bouncerData.result || 'unknown';

    console.log(`Email verification result: ${category}`);

    // If the email is undeliverable, stop processing
    if (category === 'undeliverable') {
      console.log(`Email is undeliverable, stopping process.`);
      return { statusCode: 400, body: JSON.stringify({ error: 'Email is undeliverable' }) };
    }

    // ✅ Step 3: Add the email to Iterable
    console.log(`Adding email to Iterable list: ${email}`);
    await fetch('https://api.iterable.com/api/users/subscribe', {
      method: 'POST',
      headers: {
        'Api-Key': ITERABLE_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: email, listId: ITERABLE_LIST_ID })
    });

    // ✅ Step 4: Send the email to PTR Webhook
    console.log(`Sending email to PTR: ${email}`);
    await fetch(`${PTR_WEBHOOK_URL}${encodeURIComponent(email)}`);

    // ✅ Step 5: Store the email in Google Sheets
    console.log(`Appending email to Google Sheets: ${email} under ${category}`);
    await appendRow(email, category);

    // ✅ Step 6: Return success response
    return { statusCode: 200, body: JSON.stringify({ success: true, category: category }) };
  } catch (error) {
    console.error(`Error processing email: ${error.message}`);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
