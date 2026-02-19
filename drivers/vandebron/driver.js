'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

module.exports = class VandebronDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onOAuth2Init() {
    this.log('VandebronDriver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices({ oAuth2Client }) {
    const userId = await oAuth2Client.getUserId();
    const organizationId = await oAuth2Client.getUserOrganizationId(userId);
    const greenestMoment = await oAuth2Client.getTodaysGreenestMoment(organizationId);

    return [
      {
        name: 'Vandebron',
        data: {
          id: userId,
        },
        store: {
          userId,
          organizationId,
          greenestMoment,
          username: this.homey.settings.get('username'),
          password: this.homey.settings.get('password'),
        },
      },
    ];
  }

};
