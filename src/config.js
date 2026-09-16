export const SUPPORT_REQUESTS_CHANNEL_ID =
  process.env.SUPPORT_REQUESTS_CHANNEL_ID ?? '1549096181903401130';
export const SUPPORT_PING_ROLE_IDS = {
  general: ['1449091238107283639', '1473706134467510364'],
  partnership: ['1468302255181529295', '1475109255945392229']
};
export const SUPPORT_COLORS = {
  unclaimed: 0x808080,
  inProgress: 0xffcc00,
  closed: 0x2ecc71,
  relay: 0xff0000,
  welcome: 0xff0000
};
export const APPLICATIONS_CHANNEL_ID = process.env.APPLICATIONS_CHANNEL_ID ?? '';
export const APPLICATION_PING_ROLE_IDS = ['1449091238107283639', '1473706134467510364'];
export const DEPARTMENTS = ['Pilots', 'Cabin Crew', 'Ground Crew', 'ATC', 'Management'];
export const APPLICATION_COLORS = {
  submitted: 0x808080,
  review: 0xffcc00,
  shortlisted: 0x3498db,
  interview: 0x9b59b6,
  interview_done: 0x9b59b6,
  accepted: 0x2ecc71,
  rejected: 0xff0000
};
