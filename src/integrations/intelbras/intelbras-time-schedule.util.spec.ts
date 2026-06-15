import {
  buildAccessTimeScheduleQueryString,
  buildTimeSectionsRecordUpdaterParams,
  formatTimeSectionsQueryValue,
  toDeviceTime,
} from './intelbras-time-schedule.util';

describe('intelbras-time-schedule.util', () => {
  describe('toDeviceTime', () => {
    it('normaliza HH:MM para HH:MM:SS', () => {
      expect(toDeviceTime('07:30')).toBe('07:30:00');
      expect(toDeviceTime('07:30:00')).toBe('07:30:00');
    });
  });

  describe('buildTimeSectionsRecordUpdaterParams', () => {
    it('usa formato indexado TimeSections[n]=zona', () => {
      expect(buildTimeSectionsRecordUpdaterParams([2, 1, 2])).toBe(
        'TimeSections[0]=1&TimeSections[1]=2',
      );
    });

    it('usa 255 quando vazio', () => {
      expect(buildTimeSectionsRecordUpdaterParams([])).toBe(
        'TimeSections[0]=255',
      );
    });
  });

  describe('formatTimeSectionsQueryValue', () => {
    it('formata multiplas zonas ordenadas e unicas', () => {
      expect(formatTimeSectionsQueryValue([2, 1, 2])).toBe('[1,2]');
    });

    it('usa 255 quando vazio', () => {
      expect(formatTimeSectionsQueryValue([])).toBe('[255]');
    });
  });

  describe('buildAccessTimeScheduleQueryString', () => {
    it('mantem colchetes literais nos nomes e codifica espaco no valor', () => {
      const qs = buildAccessTimeScheduleQueryString(
        {
          monday: [{ start: '07:00', end: '12:00' }],
        },
        3,
        'Periodo Manha',
      );

      expect(qs).toContain('action=setConfig');
      expect(qs).toContain('AccessTimeSchedule[3].Name=Periodo%20Manha');
      expect(qs).toContain('AccessTimeSchedule[3].Enable=true');
      expect(qs).toContain(
        'AccessTimeSchedule[3].TimeSchedule[1][0]=1%2007:00:00-12:00:00',
      );
      expect(qs).toContain(
        'AccessTimeSchedule[3].TimeSchedule[1][1]=1%2000:00:00-00:00:00',
      );
      expect(qs).not.toContain('TimeSchedule[0][');
      expect(qs).not.toContain('%5B');
      expect(qs).not.toContain('%5D');
    });
  });
});
