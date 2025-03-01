const fetch = require('node-fetch');
const { google } = require('googleapis');
const GoogleAuth = require('google-auth-library').GoogleAuth;

// API Keys and Configuration
const BOUNCER_API_KEY = process.env.BOUNCER_API_KEY; // Correct API key header
const ITERABLE_API_KEY = '50bbcd361434491eb1208156904fb76e';
const ITERABLE_LIST_ID = 'TP';

// Webhook URLs
const PTR_WEBHOOK_URL = 'https://pro.ptrtrk.com/RpeLOf?utm_source=tpnew&email=';
const TSI_WEBHOOK_URL = 'https://pro.khmtrk01.com/ZmeHh5?email=';

// Google Sheets Configuration
const SPREADSHEET_ID = '1syVupXmoT69HFoKtNq_d68hDhP-l2WGQEETc172WPfY';

// Initialize Google Sheets API client
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// Function to append data to the correct sheet
async function appendRow(email, action, source) {
  const SHEET_NAME = action.charAt(0).toUpperCase() + action.slice(1);

  if (!['Deliverable', 'Risky', 'Undeliverable', 'Unknown'].includes(SHEET_NAME)) {
    console.error(`Invalid category: ${SHEET_NAME}`);
    return;
  }

  const rowData = [[email, action, source]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:C`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rowData }
  });

  console.log(`Email added to ${SHEET_NAME} sheet with source: ${source}`);
}

// Function to send email to external lists
async function sendToWebhooks(email) {
  try {
    console.log(`Sending email to PTR List: ${email}`);
    await fetch(`${PTR_WEBHOOK_URL}${encodeURIComponent(email)}`);

    console.log(`Sending email to TSI List: ${email}`);
    await fetch(`${TSI_WEBHOOK_URL}${encodeURIComponent(email)}`);

    console.log(`Email successfully sent to both external lists.`);
  } catch (error) {
    console.error(`Error sending email to webhooks: ${error.message}`);
  }
}

// Main API handler function
exports.handler = async function(event, context) {
  try {
    // ✅ Step 1: Get the email & leadsource from request
    const email = event.queryStringParameters && event.queryStringParameters.email;
    const leadsource = event.queryStringParameters && event.queryStringParameters.leadsource;

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email parameter' }) };
    }
    if (!leadsource) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing leadsource parameter' }) };
    }

    console.log(`Verifying email: ${email} | Lead Source: ${leadsource}`);
    console.log(`Using Bouncer API Key: ${BOUNCER_API_KEY ? "Set" : "Not Set"}`);

    // ✅ Step 2: Verify the email with Bouncer API (UPDATED ENDPOINT & HEADERS)
    const bouncerRes = await fetch(`https://api.usebouncer.com/v1.1/email/verify?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'x-api-key': BOUNCER_API_KEY, // ✅ Updated Header
        'Content-Type': 'application/json'
      }
    });
    const bouncerData = await bouncerRes.json();
    console.log("Bouncer API Full Response:", JSON.stringify(bouncerData, null, 2));

    if (bouncerData.status === 401) {
      console.error("Bouncer API returned Unauthorized (401). Check your API key.");
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized - Invalid API Key" }) };
    }

    const action = bouncerData.status || 'unknown';
    console.log(`Email Category Received: ${action}`);

    // ✅ Step 3: Store the email in Google Sheets (all emails are stored)
    console.log(`Appending email to Google Sheets: ${email} | Action: ${action} | Source: ${leadsource}`);
    await appendRow(email, action, leadsource);

    // ✅ Step 4: Stop processing for "undeliverable" & "risky"
    if (action === 'undeliverable' || action === 'risky') {
      console.log(`Email is ${action}, stopping further processing.`);
      return { statusCode: 400, body: JSON.stringify({ error: `Email is ${action}` }) };
    }

    // ✅ Step 5: Add the email to Iterable
    console.log(`Adding email to Iterable list: ${email}`);
    // First, try updating the user in Iterable
const iterableUpdate = await fetch("https://api.iterable.com/api/users/update", {
  method: "POST",
  headers: {
    "Api-Key": iterableConfig.apiKey,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    email: email,
    dataFields: { source: leadsource }
  })
});

const updateData = await iterableUpdate.json();
console.log("Iterable Update Response:", updateData);

// If the user is not found, subscribe them
if (updateData.code === "UserNotFound") {
  console.log(`User not found, subscribing: ${email}`);
  await fetch("https://api.iterable.com/api/users/subscribe", {
    method: "POST",
    headers: {
      "Api-Key": iterableConfig.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: email,
      listId: iterableConfig.listId,
      dataFields: { source: leadsource }
    })
  });
}

// Trigger Custom Event to Restart Workflow
await fetch("https://api.iterable.com/api/events/track", {
  method: "POST",
  headers: {
    "Api-Key": iterableConfig.apiKey,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    email: email,
    eventName: "welcome_email_trigger",  // Custom event to restart workflow
    dataFields: {
      source: leadsource,
      timestamp: new Date().toISOString()  // Ensure it's a fresh event
    }
  })
});

    // ✅ Step 6: Send the email to both PTR and TSI Webhooks
    await sendToWebhooks(email);

    // ✅ Step 7: Return success response
    const redirectUrl = `https://traderspro.nicepage.io/FreeReports?email=${encodeURIComponent(email)}&leadsource=${encodeURIComponent(leadsource)}`;
return {
  statusCode: 302, // HTTP Redirect
  headers: { "Location": redirectUrl },
  body: JSON.stringify({ success: true, action: action })
};

  } catch (error) {
    console.error(`Error processing email: ${error.message}`);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
