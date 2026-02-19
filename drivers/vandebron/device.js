'use strict';

const { OAuth2Device } = require('homey-oauth2app');

module.exports = class VandebronDevice extends OAuth2Device {

  async onOAuth2Init() {
    this.log('VandebronDevice has been initialized');

    this._intervals = [];
    this._tokenRefreshTimeout = null;

    this.homey.flow.getConditionCard('greenest_moment_now')
      .registerRunListener(async (args, state) => {
        const value = this.getCapabilityValue('alarm_greenest_moment');
        this.log('Flow condition greenest_moment_now checked, value:', value);
        return value;
      });

    // Initial sync — each step independent so one failure doesn't block others
    try {
      await this.syncGreenestMomentInfo();
      await this.setGreenestMomentCapability();
      await this.setAlarmGreenestMomentCapability();
    } catch (err) {
      this.error('Initial greenest moment sync failed:', err.message);
    }

    try {
      await this.syncGreenEnergyPercentage();
    } catch (err) {
      this.error('Initial green energy sync failed:', err.message);
    }

    // Schedule token refresh based on token lifetime
    this._scheduleTokenRefresh();

    // Sync data every 30 minutes
    this._intervals.push(this.homey.setInterval(async () => {
      this.log('Running scheduled data sync');
      try {
        await this.syncGreenestMomentInfo();
        await this.setGreenestMomentCapability();
      } catch (err) {
        this.error('Greenest moment sync failed:', err.message);
      }
      try {
        await this.syncGreenEnergyPercentage();
      } catch (err) {
        this.error('Green energy sync failed:', err.message);
      }
    }, 30 * 60 * 1000));

    // Check alarm state every 10 seconds (local computation, no API call)
    this._intervals.push(this.homey.setInterval(async () => {
      try {
        await this.setAlarmGreenestMomentCapability();
      } catch (err) {
        this.error('Alarm check failed:', err.message);
      }
    }, 10 * 1000));

    this.log('VandebronDevice initialization complete');
  }

  _getTokenExpiresIn() {
    try {
      const token = this.oAuth2Client._token;
      if (token && token.expires_in) {
        return token.expires_in;
      }
    } catch (err) {
      // ignore
    }
    return 900; // default 15 minutes
  }

  _scheduleTokenRefresh() {
    if (this._tokenRefreshTimeout) {
      this.homey.clearTimeout(this._tokenRefreshTimeout);
    }

    const expiresIn = this._getTokenExpiresIn();
    const refreshIn = Math.max(expiresIn * 0.75, 60) * 1000; // 75% of lifetime, minimum 1 minute

    this.log(`Scheduling token refresh in ${Math.round(refreshIn / 1000)}s (token expires in ${expiresIn}s)`);

    this._tokenRefreshTimeout = this.homey.setTimeout(async () => {
      try {
        await this.oAuth2Client.refreshToken();
        this.log('Token refreshed successfully');
      } catch (err) {
        this.error('Token refresh failed, trying credential refresh:', err.message);
        try {
          await this.oAuth2Client.getTokenByCredentials({
            username: this.getStoreValue('username'),
            password: this.getStoreValue('password'),
          });
          this.log('Credential refresh succeeded');
        } catch (credErr) {
          this.error('Credential refresh also failed:', credErr.message);
        }
      }

      // Reschedule regardless of success/failure
      this._scheduleTokenRefresh();
    }, refreshIn);
  }

  /*
    Synchronisation methods
  */
  async syncGreenestMomentInfo() {
    this.log('Syncing greenest moment from API');
    const greenestMoment = await this.oAuth2Client.getTodaysGreenestMoment(this.getStoreValue('organizationId'));
    this.log('Received greenest moment:', JSON.stringify(greenestMoment));
    await this.setStoreValue('greenestMoment', greenestMoment);
  }

  async syncGreenEnergyPercentage() {
    this.log('Syncing green energy percentage from API');
    const greenEnergyPercentage = Math.round(await this.oAuth2Client.getGreenEnergyPercentage(this.getStoreValue('organizationId')));

    this.log('Setting green energy percentage to', greenEnergyPercentage, '%');
    await this.setCapabilityValue('measure_green_energy', greenEnergyPercentage);
    this.homey.api.realtime('measure_green_energy', greenEnergyPercentage);
  }

  /*
    Set capability methods
  */
  async setGreenestMomentCapability() {
    const greenestMoment = this.getStoreValue('greenestMoment');
    if (!greenestMoment) {
      this.log('No greenest moment data in store, skipping capability update');
      return;
    }

    const timezone = this.homey.clock.getTimezone();

    function formatToLocalTime(utcDateStr, tz) {
      const date = new Date(utcDateStr);
      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: tz,
      });
    }

    const startTime = formatToLocalTime(greenestMoment.windowStart, timezone);
    const endTime = formatToLocalTime(greenestMoment.windowEnd, timezone);
    const display = `${startTime} - ${endTime}`;

    this.log('Setting greenest_moment capability to:', display);
    await this.setCapabilityValue('greenest_moment', display);
    this.homey.api.realtime('greenest_moment', display);
  }

  async setAlarmGreenestMomentCapability() {
    const greenestMoment = this.getStoreValue('greenestMoment');
    if (!greenestMoment) {
      this.log('No greenest moment data in store, skipping alarm update');
      return;
    }

    const now = new Date();
    const windowStart = new Date(greenestMoment.windowStart);
    const windowEnd = new Date(greenestMoment.windowEnd);
    const isActive = now >= windowStart && now <= windowEnd;
    const currentValue = this.getCapabilityValue('alarm_greenest_moment');

    // only set if the current capability value is different
    if (currentValue === isActive) {
      return;
    }

    this.log(`Greenest moment alarm: ${currentValue} -> ${isActive} (now: ${now.toISOString()}, window: ${greenestMoment.windowStart} - ${greenestMoment.windowEnd})`);
    await this.setCapabilityValue('alarm_greenest_moment', isActive);
    this.homey.api.realtime('alarm_greenest_moment', isActive);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('VandebronDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }) {
    this.log('VandebronDevice settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('VandebronDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onOAuth2Deleted() {
    if (this._tokenRefreshTimeout) {
      this.homey.clearTimeout(this._tokenRefreshTimeout);
    }
    for (const interval of this._intervals) {
      this.homey.clearInterval(interval);
    }
    this.log('VandebronDevice has been deleted');
  }

};
