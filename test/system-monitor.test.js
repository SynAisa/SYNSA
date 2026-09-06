const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePing, parseStatistics } = require('../system/monitor');

test('parses English and German Windows ping summaries', () => {
  assert.deepEqual(parsePing('Packets: Sent = 3, Received = 3, Lost = 0 (0% loss)\nAverage = 24ms'), {
    packetLossPercent: 0,
    latencyMs: 24,
  });
  assert.deepEqual(parsePing('Pakete: Gesendet = 3, Empfangen = 0, Verloren = 3 (100% Verlust)\nMittelwert = 0ms'), {
    packetLossPercent: 100,
    latencyMs: 0,
  });
});

test('sums Windows adapter byte counters and handles a single adapter', () => {
  assert.deepEqual(parseStatistics('[{"ReceivedBytes":12,"SentBytes":5},{"ReceivedBytes":7,"SentBytes":3}]'), { received: 19, sent: 8 });
  assert.deepEqual(parseStatistics('{"ReceivedBytes":12,"SentBytes":5}'), { received: 12, sent: 5 });
});
