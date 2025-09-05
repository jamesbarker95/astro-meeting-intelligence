// import * as keytar from 'keytar';
import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

interface SalesforceTokens extends OAuthTokens {
  instance_url: string;
  id: string;
}

interface SlackTokens {
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id: string;
  team: {
    name: string;
    id: string;
  };
  authed_user: {
    id: string;
    scope: string;
    access_token: string;
    token_type: string;
  };
}

interface SalesforceEvent {
  Event_Id: string;
  Title: string;
  Start: string;
  End: string;
  Description: string;
  RelatedToId: string;
  Meeting_Brief: string;
  Competitive_Intelligence: string;
  Agent_Capabilities: string;
}

interface AuthSettings {
  salesforce_client_id: string;
  salesforce_client_secret: string;
  slack_client_id: string;
  slack_client_secret: string;
  deepgram_api_key: string;
  slack_channel: string;
}

interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

// Simple in-memory storage to avoid keychain prompts
class SimpleStorage {
  private storage: Map<string, string> = new Map();

  async setPassword(service: string, account: string, password: string): Promise<void> {
    const key = `${service}:${account}`;
    this.storage.set(key, password);
  }

  async getPassword(service: string, account: string): Promise<string | null> {
    const key = `${service}:${account}`;
    return this.storage.get(key) || null;
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    const key = `${service}:${account}`;
    return this.storage.delete(key);
  }
}

export class AuthManager {
  private readonly serviceName = 'astro-app';
  private readonly salesforceAccount = 'salesforce';
  private readonly slackAccount = 'slack';
  private readonly settingsAccount = 'settings';
  private oauthServer: https.Server | null = null;
  private pkceChallenges: Map<string, PKCEChallenge> = new Map();
  private storage = new SimpleStorage();
  private mainWindow: Electron.BrowserWindow | null = null;

  constructor() {
    this.initializeSettings();
    this.startOAuthServer();
  }

  setMainWindow(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  private async initializeSettings(): Promise<void> {
    // Set default settings if they don't exist
    const existingSettings = await this.getSettings();
    if (!existingSettings) {
      const defaultSettings: AuthSettings = {
        salesforce_client_id: '3MVG9Rr0EZ2YOVMa1kkbcICIjiHR7NASkR1K6trIxajevO2otYLhqFAODPoVxPCOkIP5v0kli9dMH7kQjrml1',
        salesforce_client_secret: '0DC7040F3CC4779D889D69A2C5A2C67EC5CD5D5D8ACF909BFBD1CCB08D51ABA2',
        slack_client_id: '8072880940752.9433536186757',
        slack_client_secret: '8ad23c2b9c52adab425d44a13a379992',
        deepgram_api_key: '547f2a8ba13eab840e01d9f8cf1bb5dc8d1bf259',
        slack_channel: '#general'
      };
      await this.updateSettings(defaultSettings);
    }
  }

  private generatePKCEChallenge(): PKCEChallenge {
    // Generate a random code verifier
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    
    // Generate code challenge using SHA256
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    
    return { codeVerifier, codeChallenge };
  }

  private generateSelfSignedCert(): { key: string; cert: string } {
    // Generate a simple self-signed certificate for development
    const { execSync } = require('child_process');
    const certDir = path.join(os.tmpdir(), 'astro-oauth-certs');
    
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');

    // Generate self-signed certificate if it doesn't exist
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      try {
        execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Astro/CN=localhost"`, { stdio: 'pipe' });
        console.log('Generated self-signed certificate for HTTPS');
      } catch (error) {
        console.error('Failed to generate certificate, falling back to HTTP:', error);
        throw new Error('Certificate generation failed');
      }
    }

    return {
      key: fs.readFileSync(keyPath, 'utf8'),
      cert: fs.readFileSync(certPath, 'utf8')
    };
  }

  private startOAuthServer(): void {
    if (this.oauthServer) {
      return; // Server already running
    }

    try {
      const certs = this.generateSelfSignedCert();
      
      this.oauthServer = https.createServer({
        key: certs.key,
        cert: certs.cert
      }, async (req, res) => {
        try {
          const parsedUrl = url.parse(req.url || '', true);
          const pathname = parsedUrl.pathname;
          const query = parsedUrl.query;

          console.log('OAuth callback received:', pathname, query);

          if (pathname === '/oauth/salesforce/callback') {
            const success = await this.handleSalesforceCallback(query);
            this.sendOAuthResponse(res, success, 'Salesforce');
          } else if (pathname === '/oauth/slack/callback') {
            const success = await this.handleSlackCallback(query);
            this.sendOAuthResponse(res, success, 'Slack');
          } else {
            res.writeHead(404);
            res.end('Not Found');
          }
        } catch (error) {
          console.error('Error handling OAuth callback:', error);
          this.sendOAuthResponse(res, false, 'Unknown');
        }
      });

      this.oauthServer.listen(3000, () => {
        console.log('HTTPS OAuth server listening on port 3000');
      });

    } catch (error) {
      console.error('Failed to start HTTPS server, falling back to HTTP:', error);
      // Fallback to HTTP if HTTPS fails
      this.startHttpFallback();
    }
  }

  private startHttpFallback(): void {
    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = url.parse(req.url || '', true);
        const pathname = parsedUrl.pathname;
        const query = parsedUrl.query;

        console.log('HTTP OAuth callback received:', pathname, query);

        if (pathname === '/oauth/salesforce/callback') {
          const success = await this.handleSalesforceCallback(query);
          this.sendOAuthResponse(res, success, 'Salesforce');
        } else if (pathname === '/oauth/slack/callback') {
          const success = await this.handleSlackCallback(query);
          this.sendOAuthResponse(res, success, 'Slack');
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      } catch (error) {
        console.error('Error handling OAuth callback:', error);
        this.sendOAuthResponse(res, false, 'Unknown');
      }
    });

    server.listen(3000, () => {
      console.log('HTTP OAuth server listening on port 3000 (fallback)');
    });

    this.oauthServer = server as any; // Type assertion for compatibility
  }

  private sendOAuthResponse(res: http.ServerResponse, success: boolean, service: string): void {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Astro OAuth</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .success { color: green; }
            .error { color: red; }
            .message { margin: 20px 0; }
          </style>
        </head>
        <body>
          <h1>Astro OAuth</h1>
          <div class="message ${success ? 'success' : 'error'}">
            <h2>${success ? '✅ Success!' : '❌ Error'}</h2>
            <p>${success ? `${service} authentication completed successfully!` : `${service} authentication failed.`}</p>
            <p>You can close this window and return to Astro.</p>
          </div>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `;
    
    res.end(html);
  }

  public getSalesforceAuthUrl(): string {
    const settings = this.getSettingsSync();
    
    // Generate PKCE challenge for Salesforce
    const pkce = this.generatePKCEChallenge();
    const state = crypto.randomBytes(16).toString('hex');
    
    // Store the PKCE challenge and state for later use
    this.pkceChallenges.set(state, pkce);
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: settings.salesforce_client_id,
      redirect_uri: 'https://localhost:3000/oauth/salesforce/callback',
      scope: 'api refresh_token offline_access',
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      state: state
    });
    
    const url = `https://login.salesforce.com/services/oauth2/authorize?${params.toString()}`;
    console.log('Generated Salesforce auth URL with PKCE:', url);
    return url;
  }

  public getSlackAuthUrl(): string {
    const settings = this.getSettingsSync();
    const params = new URLSearchParams({
      client_id: settings.slack_client_id,
      scope: 'channels:read,chat:write,chat:write.customize',
      redirect_uri: 'https://localhost:3000/oauth/slack/callback'
    });
    
    const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    console.log('Generated Slack auth URL:', url);
    return url;
  }

  public async handleOAuthCallback(url: string): Promise<boolean> {
    // This method is kept for backward compatibility but now uses HTTP server
    console.log('Legacy OAuth callback received:', url);
    return false;
  }

  private async handleSalesforceCallback(query: any): Promise<boolean> {
    try {
      console.log('Handling Salesforce callback...');
      const code = query.code;
      const state = query.state;
      const error = query.error;
      
      if (error) {
        console.error('Salesforce OAuth error:', error, query.error_description);
        return false;
      }
      
      if (!code) {
        console.error('No authorization code received from Salesforce');
        return false;
      }

      if (!state) {
        console.error('No state parameter received from Salesforce');
        return false;
      }

      // Get the stored PKCE challenge
      const pkce = this.pkceChallenges.get(state);
      if (!pkce) {
        console.error('No PKCE challenge found for state:', state);
        return false;
      }

      console.log('Salesforce authorization code received:', code.substring(0, 10) + '...');

      const settings = this.getSettingsSync();
      const tokenResponse = await fetch('https://login.salesforce.com/services/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          client_id: settings.salesforce_client_id,
          client_secret: settings.salesforce_client_secret,
          redirect_uri: 'https://localhost:3000/oauth/salesforce/callback',
          code_verifier: pkce.codeVerifier
        })
      });

      console.log('Salesforce token response status:', tokenResponse.status);

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Salesforce token exchange failed:', errorText);
        return false;
      }

      const tokens = await tokenResponse.json() as SalesforceTokens;
      console.log('Salesforce tokens received:', { 
        access_token: tokens.access_token ? 'present' : 'missing',
        instance_url: tokens.instance_url 
      });
      
      await this.storeSalesforceTokens(tokens);
      
      // Clean up the PKCE challenge
      this.pkceChallenges.delete(state);
      
      console.log('Salesforce OAuth successful');
      return true;
    } catch (error) {
      console.error('Error handling Salesforce callback:', error);
      return false;
    }
  }

  private async handleSlackCallback(query: any): Promise<boolean> {
    try {
      console.log('Handling Slack callback...');
      const code = query.code;
      if (!code) {
        console.error('No authorization code received from Slack');
        return false;
      }

      console.log('Slack authorization code received:', code.substring(0, 10) + '...');

      const settings = this.getSettingsSync();
      
      // Slack OAuth v2 token exchange
      const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: settings.slack_client_id,
          client_secret: settings.slack_client_secret,
          code: code,
          redirect_uri: 'https://localhost:3000/oauth/slack/callback'
        })
      });

      console.log('Slack token response status:', tokenResponse.status);

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Slack token exchange failed:', errorText);
        return false;
      }

      const response = await tokenResponse.json() as any;
      console.log('Slack OAuth response:', response);
      
      if (!response.ok) {
        console.error('Slack OAuth failed:', response.error);
        return false;
      }

      // Store the Slack tokens
      await this.storeSlackTokens(response as SlackTokens);
      
      console.log('Slack OAuth successful');
      return true;
    } catch (error) {
      console.error('Error handling Slack callback:', error);
      return false;
    }
  }

  private async storeSalesforceTokens(tokens: SalesforceTokens): Promise<void> {
    await this.storage.setPassword(this.serviceName, this.salesforceAccount, JSON.stringify(tokens));
    console.log('Salesforce tokens stored successfully');
  }

  private async storeSlackTokens(tokens: SlackTokens): Promise<void> {
    await this.storage.setPassword(this.serviceName, this.slackAccount, JSON.stringify(tokens));
    console.log('Slack tokens stored successfully');
  }

  public async getStoredTokens(): Promise<{
    salesforce: SalesforceTokens | null;
    slack: SlackTokens | null;
  }> {
    try {
          const salesforceTokenString = await this.storage.getPassword(this.serviceName, this.salesforceAccount);
    const slackTokenString = await this.storage.getPassword(this.serviceName, this.slackAccount);

      return {
        salesforce: salesforceTokenString ? JSON.parse(salesforceTokenString) : null,
        slack: slackTokenString ? JSON.parse(slackTokenString) : null
      };
    } catch (error) {
      console.error('Error retrieving stored tokens:', error);
      return { salesforce: null, slack: null };
    }
  }

  /**
   * Extract User ID from Salesforce identity URL
   * Example: https://login.salesforce.com/id/00D000000000000EAA/005000000000000AAA
   * Returns: 005000000000000AAA (User ID)
   */
  public extractSalesforceUserId(identityUrl: string): string | null {
    try {
      console.log('🔍 MAIN PROCESS: Extracting User ID from URL:', identityUrl);
      const urlParts = identityUrl.split('/');
      console.log('🔍 MAIN PROCESS: URL parts:', urlParts);
      
      // The User ID is the last part of the identity URL
      const userId = urlParts[urlParts.length - 1];
      console.log('🔍 MAIN PROCESS: Extracted potential User ID:', userId);
      
      // Validate it looks like a Salesforce User ID (starts with 005 and is 15 or 18 chars)
      if (userId && (userId.startsWith('005')) && (userId.length === 15 || userId.length === 18)) {
        console.log('🔍 MAIN PROCESS: ✅ Valid Salesforce User ID:', userId);
        return userId;
      }
      
      console.error('🔍 MAIN PROCESS: ❌ Invalid Salesforce User ID format:', {
        userId,
        'startsWith005': userId?.startsWith('005'),
        length: userId?.length,
        expectedLength: '15 or 18'
      });
      return null;
    } catch (error) {
      console.error('🔍 MAIN PROCESS: Error extracting Salesforce User ID:', error);
      return null;
    }
  }

  /**
   * Call Salesforce flow to get user events
   * Uses the Astro_Get_User_Events flow with User_Id input
   */
  public async getUserEvents(): Promise<SalesforceEvent[]> {
    try {
      console.log('🔍 MAIN PROCESS: getUserEvents() called');
      const tokens = await this.getStoredTokens();
      if (!tokens.salesforce) {
        console.error('🔍 MAIN PROCESS: No Salesforce tokens available');
        return [];
      }

      // Extract User ID from the identity URL
      console.log('🔍 MAIN PROCESS: Raw Salesforce identity URL:', tokens.salesforce.id);
      console.log('🔍 MAIN PROCESS: Salesforce instance URL:', tokens.salesforce.instance_url);
      console.log('🔍 MAIN PROCESS: Access token available:', !!tokens.salesforce.access_token);
      console.log('🔍 MAIN PROCESS: Access token length:', tokens.salesforce.access_token?.length || 0);
      
      const userId = this.extractSalesforceUserId(tokens.salesforce.id);
      if (!userId) {
        console.error('🔍 MAIN PROCESS: Could not extract User ID from Salesforce tokens');
        console.error('🔍 MAIN PROCESS: Identity URL was:', tokens.salesforce.id);
        return [];
      }

      // User ID extracted for potential future use
      console.log('🔍 MAIN PROCESS: ✅ Extracted User ID:', userId);
      console.log('🔍 MAIN PROCESS: 🚀 Calling Salesforce flow with User ID:', userId);

      // Call the Salesforce flow
      const flowUrl = `${tokens.salesforce.instance_url}/services/data/v61.0/actions/custom/flow/Astro_Get_User_Events`;
      const requestBody = {
        inputs: [{
          User_Id: userId
        }]
      };
      
      console.log('🔍 MAIN PROCESS: 📡 Flow URL:', flowUrl);
      console.log('🔍 MAIN PROCESS: 📦 Request body:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(flowUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.salesforce.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      console.log('🔍 MAIN PROCESS: 📡 Response status:', response.status, response.statusText);
      console.log('🔍 MAIN PROCESS: 📡 Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        console.error('🔍 MAIN PROCESS: Salesforce flow call failed:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('🔍 MAIN PROCESS: Error response body:', errorText);
        return [];
      }

      const flowResult = await response.json() as any[];
      console.log('🔍 MAIN PROCESS: 📋 Salesforce flow result:', JSON.stringify(flowResult, null, 2));

      // Parse the flow output
      if (Array.isArray(flowResult) && flowResult.length > 0 && flowResult[0]?.outputValues) {
        const userEvents = flowResult[0].outputValues.User_Events;
        console.log('🔍 MAIN PROCESS: 📋 User_Events type:', typeof userEvents);
        console.log('🔍 MAIN PROCESS: 📋 User_Events value:', userEvents);
        
        if (userEvents) {
          // Handle both Array and String formats
          if (Array.isArray(userEvents)) {
            console.log('🔍 MAIN PROCESS: ✅ User_Events is an Array, processing directly');
            const parsedEvents = this.parseUserEventsArray(userEvents);
            console.log('🔍 MAIN PROCESS: ✅ Parsed events count:', parsedEvents.length);
            return parsedEvents;
          } else if (typeof userEvents === 'string') {
            console.log('🔍 MAIN PROCESS: ✅ User_Events is a String, parsing');
            const parsedEvents = this.parseUserEventsString(userEvents);
            console.log('🔍 MAIN PROCESS: ✅ Parsed events count:', parsedEvents.length);
            return parsedEvents;
          } else {
            console.error('🔍 MAIN PROCESS: ❌ Unexpected User_Events format:', typeof userEvents);
          }
        } else {
          console.log('🔍 MAIN PROCESS: ❌ User_Events is null/undefined');
        }
      } else {
        console.log('🔍 MAIN PROCESS: ❌ Flow result structure unexpected:', {
          isArray: Array.isArray(flowResult),
          length: flowResult?.length,
          hasOutputValues: flowResult?.[0]?.outputValues ? true : false
        });
      }

      console.log('🔍 MAIN PROCESS: No events returned from Salesforce flow');
      return [];

    } catch (error) {
      console.error('Error getting user events from Salesforce:', error);
      return [];
    }
  }

  /**
   * Parse the User_Events array from Salesforce flow into structured data
   */
  private parseUserEventsArray(eventsArray: any[]): SalesforceEvent[] {
    try {
      const events: SalesforceEvent[] = [];
      
      console.log(`📋 Processing ${eventsArray.length} events from array`);
      
      for (const eventItem of eventsArray) {
        console.log('📋 Processing event item:', eventItem);
        
        if (typeof eventItem === 'string') {
          // Parse string format: "Event_Id: ...\nTitle: ...\nDescription: ...\nRelatedToId: ..."
          console.log('📋 Parsing string format event');
          const event = this.parseEventString(eventItem);
          if (event) {
            console.log('✅ Parsed event from string:', event);
            events.push(event);
          }
        } else if (eventItem && typeof eventItem === 'object') {
          // Handle object format
          console.log('📋 Parsing object format event');
          const event: SalesforceEvent = {
            Event_Id: eventItem.Event_Id || eventItem.Id || eventItem.id || 'unknown',
            Title: eventItem.Title || eventItem.Subject || eventItem.title || 'Untitled Event',
            Start: eventItem.Start || eventItem.StartDateTime || eventItem.start || '',
            End: eventItem.End || eventItem.EndDateTime || eventItem.end || '',
            Description: eventItem.Description || eventItem.description || '',
            RelatedToId: eventItem.RelatedToId || eventItem.WhatId || eventItem.relatedToId || '',
            Meeting_Brief: eventItem.Meeting_Brief || eventItem['Meeting Brief'] || '',
            Competitive_Intelligence: eventItem.Competitive_Intelligence || eventItem['Competitive Insights'] || '',
            Agent_Capabilities: eventItem.Agent_Capabilities || eventItem['Agent Capabilities'] || ''
          };
          
          console.log('✅ Parsed event from object:', event);
          events.push(event);
        } else {
          console.log('⚠️ Skipping unknown event format:', typeof eventItem);
        }
      }
      
      console.log(`✅ Successfully parsed ${events.length} events from array`);
      return events;
      
    } catch (error) {
      console.error('Error parsing user events array:', error);
      return [];
    }
  }

  /**
   * Parse a single event string into a SalesforceEvent object
   */
  private parseEventString(eventStr: string): SalesforceEvent | null {
    try {
      console.log('🔍 Parsing event string with new delimiter format...');
      
      // Check if this is the new delimiter format
      if (eventStr.includes('||EVENT_START||') && eventStr.includes('||EVENT_END||')) {
        return this.parseDelimitedEventString(eventStr);
      }
      
      // Fallback to old parsing logic for backward compatibility
      console.log('🔍 Using legacy parsing format...');
      const event: Partial<SalesforceEvent> = {};
      
      // Extract fields using AstroIsolate_ prefixes
      const extractField = (fieldName: string): string => {
        const pattern = new RegExp(`AstroIsolate_${fieldName}:\\s*([\\s\\S]*?)(?=AstroIsolate_|$)`, 'i');
        const match = eventStr.match(pattern);
        return match && match[1] ? match[1].trim() : '';
      };
      
      event.Event_Id = extractField('Event_Id');
      event.Title = extractField('Title');
      event.Start = extractField('Start');
      event.End = extractField('End');
      event.Description = extractField('Description');
      event.RelatedToId = extractField('RelatedToId');
      event.Meeting_Brief = extractField('Meeting_Brief');
      event.Competitive_Intelligence = extractField('Competitive_Insights');
      event.Agent_Capabilities = extractField('Agent_Capabilities');
      
      // Validate required fields
      if (event.Event_Id && event.Title && event.RelatedToId) {
        return {
          Event_Id: event.Event_Id,
          Title: event.Title,
          Start: event.Start || '',
          End: event.End || '',
          Description: event.Description || '',
          RelatedToId: event.RelatedToId,
          Meeting_Brief: event.Meeting_Brief || '',
          Competitive_Intelligence: event.Competitive_Intelligence || '',
          Agent_Capabilities: event.Agent_Capabilities || ''
        };
      }
      
      console.log('⚠️ Missing required fields in event:', event);
      return null;
      
    } catch (error) {
      console.error('Error parsing event string:', error);
      return null;
    }
  }

  /**
   * Parse event string with new delimiter format
   */
  private parseDelimitedEventString(eventStr: string): SalesforceEvent | null {
    try {
      console.log('🔍 Parsing delimited event format...');
      
      // Extract the content between EVENT_START and EVENT_END
      const eventMatch = eventStr.match(/\|\|EVENT_START\|\|([\s\S]*?)\|\|EVENT_END\|\|/);
      if (!eventMatch || !eventMatch[1]) {
        console.log('⚠️ No EVENT_START/EVENT_END delimiters found');
        return null;
      }
      
      const eventContent = eventMatch[1];
      const event: Partial<SalesforceEvent> = {};
      
      // Extract basic fields using AstroIsolate_ prefixes (before the first delimiter)
      const extractBasicField = (fieldName: string): string => {
        const pattern = new RegExp(`AstroIsolate_${fieldName}:\\s*([^|]*?)(?=\\s*(?:AstroIsolate_|\\|\\|))`, 'i');
        const match = eventContent.match(pattern);
        return match && match[1] ? match[1].trim() : '';
      };
      
      // Extract delimited content sections
      const extractDelimitedContent = (startDelimiter: string, endDelimiter: string): string => {
        const pattern = new RegExp(`\\|\\|${startDelimiter}\\|\\|([\\s\\S]*?)\\|\\|${endDelimiter}\\|\\|`, 'i');
        const match = eventContent.match(pattern);
        return match && match[1] ? match[1].trim() : '';
      };
      
      // Extract basic event fields
      event.Event_Id = extractBasicField('Event_Id');
      event.Title = extractBasicField('Title');
      event.Start = extractBasicField('Start');
      event.End = extractBasicField('End');
      event.Description = extractBasicField('Description');
      event.RelatedToId = extractBasicField('RelatedToId');
      
      // Extract delimited content sections
      event.Meeting_Brief = extractDelimitedContent('MEETING_BRIEF_START', 'MEETING_BRIEF_END');
      event.Competitive_Intelligence = extractDelimitedContent('COMPETITIVE_INSIGHTS_START', 'COMPETITIVE_INSIGHTS_END');
      event.Agent_Capabilities = extractDelimitedContent('AGENT_CAPABILITIES_START', 'AGENT_CAPABILITIES_END');
      
      console.log('🔍 Parsed event fields:', {
        Event_Id: event.Event_Id,
        Title: event.Title,
        Start: event.Start,
        End: event.End,
        Description: event.Description,
        RelatedToId: event.RelatedToId,
        hasMeetingBrief: !!(event.Meeting_Brief && event.Meeting_Brief.length > 0),
        hasCompetitiveIntelligence: !!(event.Competitive_Intelligence && event.Competitive_Intelligence.length > 0),
        hasAgentCapabilities: !!(event.Agent_Capabilities && event.Agent_Capabilities.length > 0),
        meetingBriefLength: event.Meeting_Brief?.length || 0,
        competitiveIntelligenceLength: event.Competitive_Intelligence?.length || 0,
        agentCapabilitiesLength: event.Agent_Capabilities?.length || 0
      });
      
      // Validate required fields
      if (event.Event_Id && event.Title && event.RelatedToId) {
        return {
          Event_Id: event.Event_Id,
          Title: event.Title,
          Start: event.Start || '',
          End: event.End || '',
          Description: event.Description || '',
          RelatedToId: event.RelatedToId,
          Meeting_Brief: event.Meeting_Brief || '',
          Competitive_Intelligence: event.Competitive_Intelligence || '',
          Agent_Capabilities: event.Agent_Capabilities || ''
        };
      }
      
      console.log('⚠️ Missing required fields in delimited event:', {
        Event_Id: event.Event_Id,
        Title: event.Title,
        RelatedToId: event.RelatedToId
      });
      return null;
      
    } catch (error) {
      console.error('Error parsing delimited event string:', error);
      return null;
    }
  }

  /**
   * Parse the User_Events string from Salesforce flow into structured data
   */
  private parseUserEventsString(eventsString: string): SalesforceEvent[] {
    try {
      const events: SalesforceEvent[] = [];
      
      // Split by comma to get individual events
      const eventStrings = eventsString.split(',Event_Id:');
      
      for (let i = 0; i < eventStrings.length; i++) {
        let eventStr = eventStrings[i];
        
        if (!eventStr) continue;
        
        // Add back the Event_Id: prefix for all but the first item
        if (i > 0) {
          eventStr = 'Event_Id:' + eventStr;
        }
        
        // Extract fields using regex
        const eventIdMatch = eventStr.match(/Event_Id:\s*([^\s]+)/);
        const titleMatch = eventStr.match(/Title:\s*([^]+?)(?=\s+Description:|$)/);
        const descriptionMatch = eventStr.match(/Description:\s*([^]+?)(?=\s+RelatedToId:|$)/);
        const relatedToIdMatch = eventStr.match(/RelatedToId:\s*([^\s,]+)/);
        
        if (eventIdMatch?.[1] && titleMatch?.[1] && relatedToIdMatch?.[1]) {
          events.push({
            Event_Id: eventIdMatch[1].trim(),
            Title: titleMatch[1].trim(),
            Start: '', // String format doesn't include Start/End in the old parsing
            End: '',   // String format doesn't include Start/End in the old parsing
            Description: descriptionMatch?.[1]?.trim() || '',
            RelatedToId: relatedToIdMatch[1].trim(),
            Meeting_Brief: '', // Legacy format doesn't include context
            Competitive_Intelligence: '', // Legacy format doesn't include context
            Agent_Capabilities: '' // Legacy format doesn't include context
          });
        }
      }
      
      console.log(`Parsed ${events.length} events from Salesforce`);
      return events;
      
    } catch (error) {
      console.error('Error parsing user events string:', error);
      return [];
    }
  }

  public async logout(): Promise<void> {
    try {
          await this.storage.deletePassword(this.serviceName, this.salesforceAccount);
    await this.storage.deletePassword(this.serviceName, this.slackAccount);
      console.log('Logged out successfully');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  }

  public async getSettings(): Promise<AuthSettings | null> {
    try {
      const settingsString = await this.storage.getPassword(this.serviceName, this.settingsAccount);
      return settingsString ? JSON.parse(settingsString) : null;
    } catch (error) {
      console.error('Error retrieving settings:', error);
      return null;
    }
  }

  public getSettingsSync(): AuthSettings {
    // For synchronous access, we'll use a simple approach
    // In a real app, you might want to cache settings in memory
    const defaultSettings: AuthSettings = {
      salesforce_client_id: '3MVG9Rr0EZ2YOVMa1kkbcICIjiHR7NASkR1K6trIxajevO2otYLhqFAODPoVxPCOkIP5v0kli9dMH7kQjrml1',
      salesforce_client_secret: '0DC7040F3CC4779D889D69A2C5A2C67EC5CD5D5D8ACF909BFBD1CCB08D51ABA2',
      slack_client_id: '8072880940752.9433536186757',
      slack_client_secret: '8ad23c2b9c52adab425d44a13a379992',
      deepgram_api_key: '547f2a8ba13eab840e01d9f8cf1bb5dc8d1bf259',
      slack_channel: '#general'
    };
    return defaultSettings;
  }

  public async updateSettings(settings: AuthSettings): Promise<void> {
    try {
      await this.storage.setPassword(this.serviceName, this.settingsAccount, JSON.stringify(settings));
      console.log('Settings updated successfully');
    } catch (error) {
      console.error('Error updating settings:', error);
    }
  }

  public async isAuthenticated(): Promise<boolean> {
    const tokens = await this.getStoredTokens();
    return !!(tokens.salesforce && tokens.slack);
  }

  // Models API client properties
  private modelsToken: string | null = null;
  private modelsTokenExpiry: number = 0;

  // Agent API properties
  private agentSessionId: string | null = null;
  private agentSequenceId: number = 0;
  private readonly agentId = '0XxHo000000yTfyKAE';
  private agentRequestInProgress: boolean = false; // Prevent concurrent requests
  
  // Agent API token management (separate from Models API)
  private agentToken: string | null = null;
  private agentTokenExpiry: number = 0;
  
  // Agent API credentials (separate from Models API)
  private readonly agentConsumerKey = '3MVG9Rr0EZ2YOVMa1kkbcICIjiC17_rf4HQqbZdWqKpc3EzRMpawcYwU03cfLAtJcNz2qjYjjZWvcMMNxV8pi';
  private readonly agentConsumerSecret = '45D658407D107DF95C6FCCBF117604DD1D625D7D4B31AD1D1858E4AEA5141F47';
  private readonly agentDomain = 'storm-65b5252966fd52.my.salesforce.com';

  private async ensureModelsToken(): Promise<void> {
    if (this.modelsToken && Date.now() < this.modelsTokenExpiry - 60000) {
      return; // Token still valid
    }

    console.log('🧠 AUTH MANAGER: Getting new Models API token...');
    
    const domain = 'storm-65b5252966fd52.my.salesforce.com';
    const consumerKey = '3MVG9Rr0EZ2YOVMa1kkbcICIjiN9OsRDWGtxxNn0YlIkWutkvtp5xoqF9_aBx7i5fA2QlGBNzA3A7fWOOv86E';
    const consumerSecret = '58444012B7A20CBE79217E1F83D53F9925DCE637A5A418FBEA0F83B4527990C3';

    const tokenUrl = `https://${domain}/services/oauth2/token`;
    const tokenData = new URLSearchParams({
      'grant_type': 'client_credentials',
      'client_id': consumerKey,
      'client_secret': consumerSecret
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenData
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('🧠 AUTH MANAGER: Token request failed:', errorText);
      throw new Error(`Failed to get Models API token: ${tokenResponse.status} ${tokenResponse.statusText}`);
    }

    const tokenResult = await tokenResponse.json() as any;
    this.modelsToken = tokenResult.access_token;
    
    // Set expiry (default 30 minutes if not provided)
    const expiresIn = tokenResult.expires_in || 1800;
    this.modelsTokenExpiry = Date.now() + (expiresIn * 1000);
    
    console.log('🧠 AUTH MANAGER: ✅ Models API token obtained successfully');
  }

  private async ensureAgentToken(): Promise<void> {
    if (this.agentToken && Date.now() < this.agentTokenExpiry - 60000) {
      return; // Token still valid
    }

    console.log('🤖 AUTH MANAGER: Getting new Agent API token...');
    
    const tokenUrl = `https://${this.agentDomain}/services/oauth2/token`;
    const tokenData = new URLSearchParams({
      'grant_type': 'client_credentials',
      'client_id': this.agentConsumerKey,
      'client_secret': this.agentConsumerSecret
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenData
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('🤖 AUTH MANAGER: Agent token request failed:', errorText);
      throw new Error(`Failed to get Agent API token: ${tokenResponse.status} ${tokenResponse.statusText}`);
    }

    const tokenResult = await tokenResponse.json() as any;
    this.agentToken = tokenResult.access_token;
    
    // Set expiry (default 30 minutes if not provided)
    const expiresIn = tokenResult.expires_in || 1800;
    this.agentTokenExpiry = Date.now() + (expiresIn * 1000);
    
    console.log('🤖 AUTH MANAGER: ✅ Agent API token obtained successfully');
  }

  public async generateMeetingSummary(
    batchText: string,
    meetingBrief?: string,
    competitiveIntelligence?: string,
    previousSummary?: string
  ): Promise<any> {
    try {
      console.log('🧠 AUTH MANAGER: Starting meeting summary generation...');
      
      // Ensure we have a valid Models API token
      await this.ensureModelsToken();

      // Use the provided batch text directly
      const transcriptText = batchText || "Sample transcript for meeting summary generation";
      
      console.log(`🧠 AUTH MANAGER: Using batch text for summary generation (${transcriptText.length} characters)`);

      // Create a comprehensive prompt with context
      let prompt = '';
      
      if (meetingBrief) {
        prompt += `Meeting Brief: ${meetingBrief}\n\n`;
      }
      
      if (competitiveIntelligence) {
        prompt += `Competitive Intelligence: ${competitiveIntelligence}\n\n`;
      }
      
      if (previousSummary) {
        prompt += `Previous Summary Context: ${previousSummary}\n\n`;
      }
      
      prompt += `Please generate a comprehensive meeting summary from the following transcript:

"${transcriptText}"

Please provide:
1. A brief summary of the main discussion points
2. Key action items that were identified
3. Any questions or concerns that were raised
4. Next steps that were mentioned

Format the response as a structured summary.`;

      console.log('🧠 AUTH MANAGER: Calling Salesforce Models API for summary...');
      
      // Use the correct model name from the other project
      const modelsUrl = 'https://api.salesforce.com/einstein/platform/v1/models/sfdc_ai__DefaultGPT4Omni/generations';
      const requestBody = {
        prompt: prompt
      };

      console.log('🧠 AUTH MANAGER: Models API URL:', modelsUrl);
      console.log('🧠 AUTH MANAGER: Request payload:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(modelsUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.modelsToken}`,
          'Content-Type': 'application/json',
          'x-sfdc-app-context': 'EinsteinGPT',
          'x-client-feature-id': 'ai-platform-models-connected-app'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('🧠 AUTH MANAGER: Models API response status:', response.status, response.statusText);
      console.log('🧠 AUTH MANAGER: Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('🧠 AUTH MANAGER: Models API call failed:', errorText);
        console.error('🧠 AUTH MANAGER: Full response details:', {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          headers: Object.fromEntries(response.headers.entries())
        });
        throw new Error(`Models API call failed: ${response.status} ${response.statusText}. Details: ${errorText}`);
      }

      const result = await response.json();
      console.log('🧠 AUTH MANAGER: ✅ Summary generated successfully:', result);

      // Extract the generated text from the Models API response
      const generatedText = (result as any)?.generation?.generatedText || 'No summary generated';
      
      // Return the raw Models API response as the summary (simplified)
      return {
        id: (result as any)?.id || 'unknown',
        summary: generatedText, // Just return the raw text from Models API
        timestamp: new Date().toISOString(),
        batchTextLength: transcriptText.length,
        hasMeetingBrief: !!meetingBrief,
        hasCompetitiveIntelligence: !!competitiveIntelligence,
        hasPreviousSummary: !!previousSummary
      };

    } catch (error) {
      console.error('🧠 AUTH MANAGER: Summary generation failed:', error);
      throw error;
    }
  }

  // Models API Session 2: Relevancy Gate for AI Insights (More Flexible for Testing)
  public async checkTranscriptRelevancy(transcriptLine: string, meetingBrief: string, competitiveIntelligence: string, agentCapabilities: string): Promise<string> {
    try {
      console.log('🔍 AUTH MANAGER: Checking transcript relevancy for AI insights...');
      
      // Emit debug event for Models API call
      this.mainWindow?.webContents.send('debug:models_api_call', {
        transcript: transcriptLine,
        timestamp: new Date().toISOString()
      });
      
      // Also send to overlay manager via custom debug handler
      if (this.mainWindow && (this.mainWindow as any).sendDebugEvent) {
        (this.mainWindow as any).sendDebugEvent('models_api_call', {
          transcript: transcriptLine,
          timestamp: new Date().toISOString()
        });
      }
      
      // Ensure we have a valid Models API token
      await this.ensureModelsToken();

      // Use chat format with system context for efficiency
      const systemContext = `You are an intelligent relevancy gate for an AI meeting assistant. Your job is to filter irrelevant content and generate context-aware requests for relevant business discussions.

MEETING CONTEXT:
Meeting Brief: ${meetingBrief}

Competitive Intelligence: ${competitiveIntelligence}

Agent Capabilities: ${agentCapabilities}

INSTRUCTIONS:
STEP 1 - RELEVANCY FILTER:
ONLY respond with "Waiting_For_More_Context" if the transcript is:
- Very short (1-2 words like "um", "okay", "yes")
- Clearly personal/casual conversation unrelated to business
- Audio artifacts, unclear speech, or meaningless sounds
- Contains no business value whatsoever

STEP 2 - IF RELEVANT, GENERATE CONTEXT-AWARE REQUEST:
1. Identify key entities in the transcript (companies, products, people, features, concepts)
2. Match those entities against the provided context data above
3. Generate a specific, actionable request that combines the transcript intent with relevant context details

SMART REQUEST EXAMPLES:
- If transcript mentions competitors found in context → "Based on our competitive intelligence about [COMPETITOR], explain our positioning advantages regarding [SPECIFIC TOPIC]"
- If discussing products/features in context → "Using our meeting brief insights, address [SPECIFIC FEATURE/TOPIC] and our strategic approach"
- If mentioning people/contacts from context → "Provide guidance on [TOPIC] considering [PERSON]'s role and our account strategy"
- If pricing/deals discussed → "Compare our pricing strategy against competitors using our competitive intelligence"
- Testing phrases → "Testing the agent"
- Generic business topics → "Analyze this business statement for competitive insights"

GOAL: Create the most specific, context-rich request possible that will help the agent provide targeted, valuable insights.`;

      const userMessage = `Analyze this transcript: "${transcriptLine}"`;

      console.log('🔍 AUTH MANAGER: System context length:', systemContext.length);
      console.log('🔍 AUTH MANAGER: User message:', userMessage);
      
      const modelsUrl = 'https://api.salesforce.com/einstein/platform/v1/models/sfdc_ai__DefaultGPT4Omni/chat-generations';
      const requestBody = {
        messages: [
          {
            role: "system",
            content: systemContext
          },
          {
            role: "user", 
            content: userMessage
          }
        ],
        localization: {
          defaultLocale: "en_US",
          inputLocales: [
            {
              locale: "en_US",
              probability: 1.0
            }
          ],
          expectedLocales: ["en_US"]
        },
        tags: {}
      };

      const response = await fetch(modelsUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.modelsToken}`,
          'Content-Type': 'application/json',
          'x-sfdc-app-context': 'EinsteinGPT',
          'x-client-feature-id': 'ai-platform-models-connected-app'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('🔍 AUTH MANAGER: Relevancy check response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('🔍 AUTH MANAGER: Relevancy check failed:', errorText);
        throw new Error(`Relevancy check failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      // Parse response according to chat-generations API documentation
      const generations = (result as any)?.generationDetails?.generations;
      let relevancyResult = 'Waiting_For_More_Context';
      
      if (generations && generations.length > 0) {
        // Find the assistant response (the API should return the model's response)
        const assistantResponse = generations.find((gen: any) => gen.role === 'assistant' || gen.role === 'system');
        if (assistantResponse && assistantResponse.content) {
          relevancyResult = assistantResponse.content;
        } else if (generations[generations.length - 1]?.content) {
          // Fallback: use the last generation's content
          relevancyResult = generations[generations.length - 1].content;
        }
      }
      
      console.log('🔍 AUTH MANAGER: Raw API response structure:', JSON.stringify(result, null, 2));
      
      console.log('🔍 AUTH MANAGER: Relevancy result:', relevancyResult);
      
      // Determine if response indicates relevance
      const isRelevant = !relevancyResult.includes('Waiting_For_More_Context');
      
      // Emit debug event for Models API response
      this.mainWindow?.webContents.send('debug:models_api_response', {
        relevant: isRelevant,
        reason: relevancyResult.trim(),
        timestamp: new Date().toISOString()
      });
      
      // Also send to overlay manager via custom debug handler
      if (this.mainWindow && (this.mainWindow as any).sendDebugEvent) {
        (this.mainWindow as any).sendDebugEvent('models_api_response', {
          relevant: isRelevant,
          reason: relevancyResult.trim(),
          timestamp: new Date().toISOString()
        });
      }
      
      return relevancyResult.trim();

    } catch (error) {
      console.error('🔍 AUTH MANAGER: Relevancy check failed:', error);
      
      // Emit debug event for error
      this.mainWindow?.webContents.send('debug:models_api_response', {
        relevant: false,
        reason: `Error: ${error}`,
        timestamp: new Date().toISOString()
      });
      
      // Also send to overlay manager via custom debug handler
      if (this.mainWindow && (this.mainWindow as any).sendDebugEvent) {
        (this.mainWindow as any).sendDebugEvent('models_api_response', {
          relevant: false,
          reason: `Error: ${error}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Return default on error to avoid breaking the flow
      return 'Waiting_For_More_Context';
    }
  }



  // Agent API session management (Updated to match reference project approach)
  public async createAgentSession(competitiveIntelligence: string, preMeetingBrief: string): Promise<void> {
    try {
      console.log('🤖 AUTH MANAGER: Creating Agent API session with OAuth client credentials...');
      
      // Use the same OAuth client credentials approach as the reference project
      await this.ensureAgentToken();
      
      const sessionUrl = `https://api.salesforce.com/einstein/ai-agent/v1/agents/${this.agentId}/sessions`;
      
      // Generate random UUID for session key
      const randomUUID = this.generateUUID();
      
      // Use the reference project's approach - context variables WITH instanceConfig
      const requestBody = {
        externalSessionKey: randomUUID,
        instanceConfig: { endpoint: `https://${this.agentDomain}` },
        variables: [
          {
            name: "Pre_Meeting_Brief",
            type: "Text",
            value: preMeetingBrief
          },
          {
            name: "Competitive_Insights",
            type: "Text", 
            value: competitiveIntelligence
          }
        ]
      };

      console.log('🤖 AUTH MANAGER: Agent session request (OAuth approach):', JSON.stringify(requestBody, null, 2));

      const response = await fetch(sessionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.agentToken}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('🤖 AUTH MANAGER: Agent session creation failed:', errorText);
        console.error('🤖 AUTH MANAGER: Response status:', response.status, response.statusText);
        console.error('🤖 AUTH MANAGER: Response headers:', Object.fromEntries(response.headers.entries()));
        throw new Error(`Failed to create Agent session: ${response.status} ${response.statusText}. Details: ${errorText}`);
      }

      const result = await response.json() as any;
      this.agentSessionId = result.sessionId;
      this.agentSequenceId = 0; // Reset sequence counter
      
      console.log('🤖 AUTH MANAGER: ✅ Agent session created with OAuth approach:', this.agentSessionId);
      
      // Emit debug event for Agent session creation
      this.mainWindow?.webContents.send('debug:agent_session_created', {
        sessionId: this.agentSessionId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('🤖 AUTH MANAGER: Agent session creation failed:', error);
      throw error;
    }
  }

  // Send streaming message to Agent API (Updated to match reference project SSE approach)
  public async sendAgentMessage(message: string, onChunk: (chunk: string) => void, onComplete: (fullResponse: string) => void, onError: (error: string) => void): Promise<void> {
    // Prevent concurrent requests to avoid 423 Locked errors
    if (this.agentRequestInProgress) {
      console.log('🤖 AUTH MANAGER: Agent request already in progress, skipping duplicate request');
      onError('Agent request already in progress');
      return;
    }

    this.agentRequestInProgress = true;
    
    try {
      if (!this.agentSessionId) {
        throw new Error('No active Agent session. Create session first.');
      }

      console.log('🤖 AUTH MANAGER: Sending message to Agent API with SSE streaming:', message);
      
      // Emit debug event for Agent message
      this.mainWindow?.webContents.send('debug:agent_message', {
        type: 'sending',
        data: message,
        sequenceId: this.agentSequenceId + 1,
        timestamp: new Date().toISOString()
      });
      
      // Also send to overlay manager via custom debug handler
      if (this.mainWindow && (this.mainWindow as any).sendDebugEvent) {
        (this.mainWindow as any).sendDebugEvent('agent_message', {
          type: 'sending',
          data: message,
          sequenceId: this.agentSequenceId + 1,
          timestamp: new Date().toISOString()
        });
      }
      
      // Ensure we have a valid Agent API token
      await this.ensureAgentToken();
      
      this.agentSequenceId++; // Increment sequence for each message
      
      const messageUrl = `https://api.salesforce.com/einstein/ai-agent/v1/sessions/${this.agentSessionId}/messages/stream`;
      
      const requestBody = {
        message: {
          sequenceId: this.agentSequenceId,
          type: "Text",
          text: message
        }
      };

      console.log('🤖 AUTH MANAGER: SSE request body:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(messageUrl, {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.agentToken}`,
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('🤖 AUTH MANAGER: SSE response status:', response.status, response.statusText);
      console.log('🤖 AUTH MANAGER: SSE response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('🤖 AUTH MANAGER: Agent message failed:', errorText);
        this.agentRequestInProgress = false; // Reset flag
        onError(`Agent API call failed: ${response.status} ${response.statusText}. Details: ${errorText}`);
        return;
      }

      // Handle Server-Sent Events (SSE) streaming like the reference project
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let buffer = '';

      if (!reader) {
        this.agentRequestInProgress = false; // Reset flag
        onError('Failed to get response stream');
        return;
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            console.log('🤖 AUTH MANAGER: SSE stream completed');
            break;
          }
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          // Process complete lines from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.trim() === '') continue;
            
            if (line.startsWith('data: ')) {
              try {
                const jsonData = line.slice(6); // Remove "data: " prefix
                if (jsonData.trim() === '') continue;
                
                const eventData = JSON.parse(jsonData);
                console.log('🤖 AUTH MANAGER: SSE event received:', eventData);
                
                // Handle different event types - events have wrapper structure with message property
                const messageData = eventData.message || eventData;
                
                if (messageData.type === 'TextChunk') {
                  // TextChunk: streaming text content
                  const chunkText = messageData.message || '';
                  fullResponse += chunkText;
                  onChunk(chunkText);
                  
                  // Emit debug event for chunk
                  this.mainWindow?.webContents.send('debug:agent_message', {
                    type: 'chunk',
                    data: chunkText,
                    sequenceId: this.agentSequenceId,
                    timestamp: new Date().toISOString()
                  });
                } else if (messageData.type === 'Inform') {
                  // Inform: complete message (this is what we're getting!)
                  const completeMessage = messageData.message || '';
                  if (completeMessage) {
                    fullResponse = completeMessage; // Use complete message
                  }
                  
                  // Emit debug event for complete message
                  this.mainWindow?.webContents.send('debug:agent_message', {
                    type: 'complete',
                    data: completeMessage,
                    sequenceId: this.agentSequenceId,
                    timestamp: new Date().toISOString()
                  });
                } else if (messageData.type === 'EndOfTurn') {
                  // Response complete
                  console.log('🤖 AUTH MANAGER: Agent response complete');
                  
                  // Emit debug event for end of turn
                  this.mainWindow?.webContents.send('debug:agent_message', {
                    type: 'end_of_turn',
                    data: fullResponse,
                    sequenceId: this.agentSequenceId,
                    timestamp: new Date().toISOString()
                  });
                  onComplete(fullResponse);
                  this.agentRequestInProgress = false; // Reset flag
                  return;
                } else if (messageData.type === 'ProgressIndicator') {
                  // Optional: could show progress to user
                  console.log('🤖 AUTH MANAGER: Agent progress:', messageData.message || 'Working on it');
                  
                  // Emit debug event for progress
                  this.mainWindow?.webContents.send('debug:agent_message', {
                    type: 'progress',
                    data: messageData.message || 'Working on it',
                    sequenceId: this.agentSequenceId,
                    timestamp: new Date().toISOString()
                  });
                }
              } catch (parseError) {
                console.warn('🤖 AUTH MANAGER: Failed to parse SSE event:', line, parseError);
              }
            }
          }
        }
        
        // If we reach here without EndOfTurn, complete with what we have
        if (fullResponse) {
          console.log('🤖 AUTH MANAGER: SSE stream ended, completing with accumulated response');
          onComplete(fullResponse);
        } else {
          onError('No response received from Agent API');
        }
        
      } finally {
        reader.releaseLock();
        this.agentRequestInProgress = false; // Reset flag
      }

    } catch (error) {
      console.error('🤖 AUTH MANAGER: Agent message streaming failed:', error);
      this.agentRequestInProgress = false; // Reset flag
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  // Generate UUID for session key
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  public cleanup(): void {
    if (this.oauthServer) {
      this.oauthServer.close();
      this.oauthServer = null;
    }
    
    // Reset Agent API session and token
    this.agentSessionId = null;
    this.agentSequenceId = 0;
    this.agentToken = null;
    this.agentTokenExpiry = 0;
  }
}

