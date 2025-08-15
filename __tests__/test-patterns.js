const { detectPatterns } = require('./lib/report/insights');

const symptom = {
  id: 'test-1',
  name: 'headache',
  severity: 5,
  timestamp: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
  tags: []
};

const patterns = detectPatterns([symptom]);
console.log('Patterns with 1 symptom:', patterns);
