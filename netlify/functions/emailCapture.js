// Debug: Check if the environment variable is set
if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_CREDENTIALS environment variable is not set!");
}
console.log("GOOGLE_SERVICE_ACCOUNT_CREDENTIALS length:", process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS.length);

const fetch = require('node-fetch');
const { google } = require('googleapis');

// API keys and configuration
const BOUNCER_API_KEY = '9CbCfpDobw6Patquus2OwCSXdIXDRuK82M9spUan';
const ITERABLE_API_KEY = '50bbcd361434491eb1208156904fb76e';
const ITERABLE_LIST_ID = 'TP'; // your Iterable list identifier

// Google Sheets configuration
const SPREADSHEET_ID = '1syVupXmoT69HFoKtNq_d68hDhP-l2WGQEETc172WPfY';
const SHEET_NAME = 'Sheet1'; // Change if your sheet tab name is different

// Initialize Google Sheets API client
// (Ensure that GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is set in your Netlify environment variables)
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// Helper function: Append a new row based on the email verification category
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

exports.handler = async function(event, context) {
  try {
    const email = event.queryStringParameters && event.queryStringParameters.email;
    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing email parameter' })
      };
    }

    // 1. Verify email using Bouncer API
    const bouncerRes = await fetch(`https://api.usebouncer.com/v2/email?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${BOUNCER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const bouncerData = await bouncerRes.json();
    const category = bouncerData.result || 'unknown';

    // 2. Add email to Iterable list
    await fetch('https://api.iterable.com/api/users/subscribe', {
      method: 'POST',
      headers: {
        'Api-Key': ITERABLE_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        listId: ITERABLE_LIST_ID
      })
    });

    // 3. Send email to PTR Main List
    await fetch(`https://pro.ptrtrk.com/RpeLOf?utm_source=tpnew&email=${encodeURIComponent(email)}`);

    // 4. Append email to Google Sheets
    await appendRow(email, category);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, category: category })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
