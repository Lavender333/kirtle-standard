// Public endpoint only. Never put database passwords or service keys in this file.
window.KIRTLE_API_BASE = ['kirtlecleans.com','www.kirtlecleans.com'].includes(location.hostname)
  ? 'https://ywuylrdtimpqhhtipqnh.supabase.co/functions/v1/kirtle-api'
  : '';
