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

// Function to append data to Google Sheets
async function appendRow(email, action, utm_source) {
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
    // ✅ Rate Limiting - Prevent Abuse
    if (context.functionCount && context.functionCount > 5) {
      console.warn("Too many requests from this IP.");
      return { statusCode: 429, body: JSON.stringify({ error: "Too many requests, slow down." }) };
    }

    // ✅ Step 1: Get the email, utm_source, and siteid from request
    const email = event.queryStringParameters?.email;
    let utm_source = event.queryStringParameters?.utm_source;
    const siteid = event.queryStringParameters?.siteid;

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email parameter' }) };
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

    // ✅ Step 2: Verify the email with Bouncer API
    const bouncerRes = await fetch(`https://api.usebouncer.com/v1.1/email/verify?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'x-api-key': BOUNCER_API_KEY,
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

    // ✅ Step 3: Store the email in Google Sheets
    console.log(`Appending email to Google Sheets: ${email} | Action: ${action} | UTM Source: ${utm_source}`);
    await appendRow(email, action, utm_source);

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
        "Api-Key": ITERABLE_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: email,
        dataFields: { source: utm_source }
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
          "Api-Key": ITERABLE_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email,
          listId: ITERABLE_LIST_ID,
          dataFields: { source: utm_source }
        })
      });
    }

    // ✅ Step 6: Trigger Custom Event to Restart Workflow
    const eventResponse = await fetch("https://api.iterable.com/api/events/track", {
      method: "POST",
      headers: {
        "Api-Key": ITERABLE_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: email,
        eventName: "welcome_email_trigger",
        dataFields: {
          source: utm_source,
          timestamp: new Date().toISOString()
        }
      })
    });

    // Log Iterable's response
    const eventData = await eventResponse.json();
    console.log("Iterable Event Response:", eventData);

    // ✅ Step 7: Send the email to both PTR and TSI Webhooks
    await sendToWebhooks(email);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, action: action })
    };

  } catch (error) {
    console.error(`Error processing email: ${error.message}`);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
