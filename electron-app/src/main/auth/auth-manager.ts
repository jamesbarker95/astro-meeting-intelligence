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

  constructor() {
    this.initializeSettings();
    this.startOAuthServer();
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
      // New parsing logic for AstroIsolate_ prefix format
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

  public async generateMeetingSummary(): Promise<any> {
    try {
      console.log('🧠 AUTH MANAGER: Starting meeting summary generation...');
      
      // Ensure we have a valid Models API token
      await this.ensureModelsToken();

      // For now, we'll use a placeholder for transcripts
      // In a real implementation, we'd collect transcripts from the current session
      const transcripts = [
        { text: "Sample transcript for meeting summary generation", timestamp: new Date().toISOString() }
      ];

      // Create a prompt for the Models API
      const transcriptText = transcripts.map(t => t.text).join(' ');
      const prompt = `Please generate a comprehensive meeting summary from the following transcript:

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
      
      // Parse the generated text to extract structured data
      // For now, we'll use the full text as summary and create placeholder structured data
      // In a more sophisticated implementation, we could prompt the AI to return JSON
      const summaryData = {
        summary: generatedText,
        actionItems: this.extractActionItems(generatedText),
        questions: this.extractQuestions(generatedText),
        nextSteps: this.extractNextSteps(generatedText)
      };

      // Return structured summary data
      return {
        id: (result as any)?.id || 'unknown',
        summary: summaryData,
        timestamp: new Date().toISOString(),
        finalTranscriptCount: 5 // This would come from the actual transcript count
      };

    } catch (error) {
      console.error('🧠 AUTH MANAGER: Summary generation failed:', error);
      throw error;
    }
  }

  // Helper methods to extract structured data from AI-generated text
  private extractActionItems(text: string): string[] {
    const actionItems: string[] = [];
    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() || '';
      if (line.toLowerCase().includes('action item') || 
          line.toLowerCase().includes('to do') ||
          line.toLowerCase().includes('follow up') ||
          (line.match(/^\d+\./) && line.toLowerCase().includes('action'))) {
        // Extract action items from numbered lists or bullet points
        const actionText = line.replace(/^\d+\./, '').replace(/^[-•*]/, '').trim();
        if (actionText.length > 0) {
          actionItems.push(actionText);
        }
      }
    }
    
    return actionItems.length > 0 ? actionItems : ['Review meeting notes and follow up on key discussion points'];
  }

  private extractQuestions(text: string): string[] {
    const questions: string[] = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes('?') || 
          trimmed.toLowerCase().includes('question') ||
          trimmed.toLowerCase().includes('concern') ||
          trimmed.toLowerCase().includes('unclear')) {
        const questionText = trimmed.replace(/^[-•*\d+\.]/, '').trim();
        if (questionText.length > 0) {
          questions.push(questionText);
        }
      }
    }
    
    return questions.length > 0 ? questions : ['No specific questions or concerns identified'];
  }

  private extractNextSteps(text: string): string[] {
    const nextSteps: string[] = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().includes('next step') ||
          trimmed.toLowerCase().includes('moving forward') ||
          trimmed.toLowerCase().includes('going forward') ||
          (trimmed.match(/^\d+\./) && trimmed.toLowerCase().includes('next'))) {
        const stepText = trimmed.replace(/^\d+\./, '').replace(/^[-•*]/, '').trim();
        if (stepText.length > 0) {
          nextSteps.push(stepText);
        }
      }
    }
    
    return nextSteps.length > 0 ? nextSteps : ['Schedule follow-up meeting to review progress'];
  }

  public cleanup(): void {
    if (this.oauthServer) {
      this.oauthServer.close();
      this.oauthServer = null;
    }
  }
}
