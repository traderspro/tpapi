const fetch = require('node-fetch');
const { google } = require('googleapis');
const GoogleAuth = require('google-auth-library').GoogleAuth;

// API Keys from Netlify Environment Variables
const BOUNCER_API_KEY = process.env.BOUNCER_API_KEY;
const ITERABLE_API_KEY = process.env.ITERABLE_API_KEY;
const ITERABLE_LIST_ID = 1478930;  // TP List ID

// Webhook URLs
const PTR_WEBHOOK_URL = 'https://pro.ptrtrk.com/RpeLOf?utm_source=tpnew&email=';
const TSI_WEBHOOK_URL = 'https://pro.khmtrk01.com/ZmeHh5?email=';

// Google Sheets Configuration
const SPREADSHEET_ID = '1syVupXmoT69HFoKtNq_d68hDhP-l2WGQEETc172WPfY';

// Allowed UTM Sources
const VALID_UTM_SOURCES = ['META', 'SMARTREC', 'GOOG1S', 'YOUTUBE'];

// Initialize Google Sheets API client
const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ✅ Background Task for Google Sheets Logging
async function appendRow(email, action, utm_source) {
  try {
    const SHEET_NAME = action.charAt(0).toUpperCase() + action.slice(1);
    if (!['Deliverable', 'Risky', 'Undeliverable', 'Unknown'].includes(SHEET_NAME)) {
      console.error(`Invalid category: ${SHEET_NAME}`);
      return;
    }

    const rowData = [[email, action, utm_source]];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A1:C`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rowData }
    });

    console.log(`Email added to ${SHEET_NAME} sheet with UTM Source: ${utm_source}`);
  } catch (error) {
    console.error(`Google Sheets Error: ${error.message}`);
  }
}

// ✅ Parallel Webhook Function
async function sendToWebhooks(email) {
  return Promise.allSettled([
    fetch(`${PTR_WEBHOOK_URL}${encodeURIComponent(email)}`).catch(err => console.error(`PTR Webhook Error: ${err.message}`)),
    fetch(`${TSI_WEBHOOK_URL}${encodeURIComponent(email)}`).catch(err => console.error(`TSI Webhook Error: ${err.message}`))
  ]);
}

// ✅ Main API handler function
exports.handler = async function(event, context) {
  try {
    // ✅ Rate Limiting - Prevent Abuse
    if (context.functionCount && context.functionCount > 5) {
      console.warn("Too many requests from this IP.");
      return { statusCode: 429, body: JSON.stringify({ error: "Too many requests, slow down." }) };
    }

    // ✅ Step 1: Get & Validate Inputs
    const email = event.queryStringParameters?.email;
    let utm_source = event.queryStringParameters?.utm_source;
    const siteid = event.queryStringParameters?.siteid;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email format' }) };
    }
    if (!utm_source) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing utm_source parameter' }) };
    }

    // ✅ Combine UTM Source and SiteID if provided
    if (siteid) {
      utm_source = `${utm_source}${siteid}`;
    }

    // ✅ Validate UTM Source (allow pre-defined sources OR sources starting with "AO")
    if (!VALID_UTM_SOURCES.includes(utm_source) && !utm_source.startsWith("AO")) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid utm_source value' }) };
    }

    console.log(`Verifying email: ${email} | Final UTM Source: ${utm_source}`);
    console.log(`Using Bouncer API Key: ${BOUNCER_API_KEY ? "Set" : "Not Set"}`);

    // ✅ Step 2: Run Bouncer First
    const bouncerRes = await fetch(`https://api.usebouncer.com/v1.1/email/verify?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: { 'x-api-key': BOUNCER_API_KEY, 'Content-Type': 'application/json' }
    }).then(res => res.json());

    console.log("Bouncer API Response:", JSON.stringify(bouncerRes, null, 2));

    if (bouncerRes.status === 401) {
      console.error("Bouncer API returned Unauthorized (401). Check your API key.");
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized - Invalid API Key" }) };
    }

    const action = bouncerRes.status || 'unknown';
    console.log(`Email Category Received: ${action}`);

    // ✅ Step 3: Store the email in Google Sheets (Run in Background)
    appendRow(email, action, utm_source);

    // ✅ Step 4: Stop processing for "undeliverable" & "risky"
    if (action === 'undeliverable' || action === 'risky') {
      console.log(`Email is ${action}, stopping further processing.`);
      return { statusCode: 400, body: JSON.stringify({ error: `Email is ${action}` }) };
    }

    // ✅ Step 5: Run Iterable & Webhooks in Parallel (Only if Email is Deliverable)
    const [iterableUpdate, webhookRes] = await Promise.all([
      fetch("https://api.iterable.com/api/users/update", {
        method: "POST",
        headers: { "Api-Key": ITERABLE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, dataFields: { source: utm_source } })
      }).then(res => res.json()),
      sendToWebhooks(email)
    ]);

    console.log("Iterable Update Response:", iterableUpdate);

    // ✅ Step 6: Subscribe to Iterable if Not Found
    if (iterableUpdate.code === "UserNotFound") {
      console.log(`User not found, subscribing: ${email}`);
      await fetch("https://api.iterable.com/api/users/subscribe", {
        method: "POST",
        headers: { "Api-Key": ITERABLE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          listId: ITERABLE_LIST_ID,
          dataFields: { source: utm_source }
        })
      });
    }

    // ✅ Step 7: Trigger Custom Iterable Event
    await fetch("https://api.iterable.com/api/events/track", {
      method: "POST",
      headers: { "Api-Key": ITERABLE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        eventName: "welcome_email_trigger",
        dataFields: { source: utm_source, timestamp: new Date().toISOString() }
      })
    });

    // ✅ Step 8: Redirect Instantly
    const redirectUrl = `https://go.traderspro.com/FreeReports?email=${encodeURIComponent(email)}&utm_source=${encodeURIComponent(utm_source)}`;
    return {
      statusCode: 302, // Redirect
      headers: { "Location": redirectUrl },
      body: JSON.stringify({ success: true, action: action })
    };

  } catch (error) {
    console.error(`Error processing email: ${error.message}`);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
