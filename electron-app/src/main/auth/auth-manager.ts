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
        salesforce_client_id: 'YOUR_SALESFORCE_CLIENT_ID',
        salesforce_client_secret: 'YOUR_SALESFORCE_CLIENT_SECRET',
        slack_client_id: 'YOUR_SLACK_CLIENT_ID',
        slack_client_secret: 'YOUR_SLACK_CLIENT_SECRET',
        deepgram_api_key: 'YOUR_DEEPGRAM_API_KEY',
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

  public cleanup(): void {
    if (this.oauthServer) {
      this.oauthServer.close();
      this.oauthServer = null;
    }
  }
}
