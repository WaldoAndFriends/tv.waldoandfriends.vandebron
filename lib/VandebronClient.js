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

    return decodedToken.preferred_username;
  }

  async getUserOrganizationId(userId) {
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

    return response.productGroups[0].resources[0].organizationId;
  }

  async getTodaysGreenestMoment(organizationId) {
    return this._withRetry(() => this.get({
      path: `/energyConsumers/${organizationId}/greenEnergyMix/window`,
      query: {
        forecastDate: new Date().toISOString()
          .split('T')[0],
        windowSize: '3H',
      },
    }));
  }

  async getGreenEnergyPercentage(organizationId) {
    const response = await this._withRetry(() => this.get({
      path: `/energyConsumers/${organizationId}/greenEnergyMix/forecast`,
      query: {
        forecastDate: new Date().toISOString()
          .split('T')[0],
      },
    }));

    const { data } = response;
    const currentTime = Date.now();

    const closestEntry = data.reduce((closest, entry) => {
      const entryTime = new Date(entry.time).getTime();
      const closestTime = new Date(closest.time).getTime();

      return Math.abs(entryTime - currentTime) < Math.abs(closestTime - currentTime) ? entry : closest;
    });

    return closestEntry.greenPercentage;
  }

};
