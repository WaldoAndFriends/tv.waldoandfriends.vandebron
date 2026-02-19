'use strict';

const jwt = require('jsonwebtoken');
const {
  OAuth2Client,
  OAuth2Error,
  OAuth2Token,
} = require('homey-oauth2app');

module.exports = class VandebronClient extends OAuth2Client {

  // Required:
  static API_URL = 'https://mijn.vandebron.nl/api/v1';
  static TOKEN_URL = 'https://vandebron.nl/auth/realms/vandebron/protocol/openid-connect/token';
  static AUTHORIZATION_URL = '';
  static SCOPES = ['profile', 'email'];
  static TOKEN = OAuth2Token;

  async _withRetry(fn, maxRetries = 3) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt === maxRetries) break;
        const delay = 2 ** (attempt + 1) * 1000; // 2s, 4s, 8s
        this.log(`Request failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay / 1000}s:`, err.message);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          this._retryTimer = this.homey.setTimeout(resolve, delay);
        });
      }
    }
    throw lastErr;
  }

  async onGetTokenByCredentials({ username, password }) {
    this.log('Getting token by credentials');
    const { settings } = this.homey;
    settings.set('username', username);
    settings.set('password', password);

    return super.onGetTokenByCredentials({
      username,
      password,
    });
  }

  async onHandleNotOK({ body, status, statusText }) {
    const message = body?.error || body?.error_description || body?.message || `${status} ${statusText}`;
    this.error(`API error: ${status} ${statusText} -`, message);
    throw new OAuth2Error(message);
  }

  async getUserId() {
    if (!this._token || !this._token.access_token) {
      throw new Error('No access token available');
    }

    const decodedToken = jwt.decode(this._token.access_token);
    if (!decodedToken) {
      throw new Error('Failed to decode access token');
    }

    this.log('Resolved userId:', decodedToken.preferred_username);
    return decodedToken.preferred_username;
  }

  async getUserOrganizationId(userId) {
    this.log('Fetching organizationId for user:', userId);
    const response = await this._withRetry(() => this.get({
      path: `/customers/${userId}/productGroups`,
    }));

    if (
      !response
      || !response.productGroups
      || !response.productGroups[0]
      || !response.productGroups[0].resources
      || !response.productGroups[0].resources[0]
    ) {
      throw new Error('Could not extract organizationId');
    }

    const { organizationId } = response.productGroups[0].resources[0];
    this.log('Resolved organizationId:', organizationId);
    return organizationId;
  }

  async getTodaysGreenestMoment(organizationId) {
    const forecastDate = new Date().toISOString().split('T')[0];
    this.log('Fetching greenest moment for date:', forecastDate);

    const result = await this._withRetry(() => this.get({
      path: `/energyConsumers/${organizationId}/greenEnergyMix/window`,
      query: {
        forecastDate,
        windowSize: '3H',
      },
    }));

    this.log('Greenest moment window:', result.windowStart, '-', result.windowEnd);
    return result;
  }

  async getGreenEnergyPercentage(organizationId) {
    const forecastDate = new Date().toISOString().split('T')[0];
    this.log('Fetching green energy forecast for date:', forecastDate);

    const response = await this._withRetry(() => this.get({
      path: `/energyConsumers/${organizationId}/greenEnergyMix/forecast`,
      query: {
        forecastDate,
      },
    }));

    const { data } = response;
    const currentTime = Date.now();

    const closestEntry = data.reduce((closest, entry) => {
      const entryTime = new Date(entry.time).getTime();
      const closestTime = new Date(closest.time).getTime();

      return Math.abs(entryTime - currentTime) < Math.abs(closestTime - currentTime) ? entry : closest;
    });

    this.log('Green energy percentage:', closestEntry.greenPercentage, '% (from', closestEntry.time, ')');
    return closestEntry.greenPercentage;
  }

};
