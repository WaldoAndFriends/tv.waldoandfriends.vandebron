'use strict';

module.exports = {
  async getGreenestMoment({
    homey,
    query,
  }) {
    const devices = homey.drivers.getDriver('vandebron').getDevices();

    if (devices.length === 0) {
      return 'No device found';
    }

    return devices[0].getCapabilityValue('greenest_moment');
  },

  async getGreenEnergyPercentage({
    homey,
    query,
  }) {
    const devices = homey.drivers.getDriver('vandebron').getDevices();

    if (devices.length === 0) {
      return 0;
    }

    return devices[0].getCapabilityValue('measure_green_energy');
  },

  async getGreenestMomentAlarm({
    homey,
    query,
  }) {
    const devices = homey.drivers.getDriver('vandebron').getDevices();

    if (devices.length === 0) {
      return false;
    }

    return devices[0].getCapabilityValue('alarm_greenest_moment');
  },
};
