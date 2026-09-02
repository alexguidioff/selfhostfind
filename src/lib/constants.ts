export const CATEGORIES = [
  'Finance', 'Photos', 'Media', 'Documents', 'Notes', 'Passwords', 'Productivity',
  'Dashboard', 'Monitoring', 'Home Automation', 'Backup', 'File Sharing',
  'Developer Tools', 'Project Management', 'Communication', 'Security',
] as const;

export const SORT_OPTIONS = [
  { value: 'health', label: 'Health score' },
  { value: 'trending', label: 'Trending' },
  { value: 'newest', label: 'Newest' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'stars', label: 'Most stars' },
] as const;
