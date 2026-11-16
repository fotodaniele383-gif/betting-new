const { scanMatchup } = require('./deepScanCalcio');

async function runCase(label, args) {
  console.log('\n==============================');
  console.log(label);
  console.log('==============================');

  try {
    const result = await scanMatchup(...args);

    console.log('success:', result.success);
    console.log('action:', result.action);
    console.log('suggestionText:', result.suggestionText);
    console.log('isHighRisk:', result.isHighRisk);

    const text = String(result.reason || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log('reason preview:', text.slice(0, 700));
  } catch (err) {
    console.error('ERRORE TEST:', err);
  }
}

(async () => {
  await runCase('CASO 1 - Edge basso: deve essere Watchlist/No Bet, non Via Libera forte', [
    'Inter',
    'Lecce',
    '1',
    1.40,
    72,
    1.2,
    1.40,
    4.60,
    8.00,
    {
      avgGoals: 2.4,
      marketVolatility: 1.00,
      mcGlobal: 58
    }
  ]);

  await runCase('CASO 2 - Edge alto ma disaccordo mercato: deve frenare come rischio/value trap', [
    'Milan',
    'Napoli',
    '1',
    2.80,
    55,
    18,
    2.80,
    3.30,
    2.45,
    {
      avgGoals: 2.7,
      marketVolatility: 1.15,
      mcGlobal: 52
    }
  ]);

  await runCase('CASO 3 - Under tattico coerente: dovrebbe essere almeno Playable/Watchlist positiva', [
    'Juventus',
    'Roma',
    'UNDER 2.5',
    1.85,
    60,
    6.5,
    2.25,
    3.00,
    3.40,
    {
      avgGoals: 2.0,
      marketVolatility: 0.95,
      mcGlobal: 70
    }
  ]);

  await runCase('CASO 4 - Over in match volatile: non deve dare verde automatico', [
    'Atalanta',
    'Fiorentina',
    'OVER 2.5',
    1.70,
    62,
    5.4,
    1.95,
    3.70,
    3.80,
    {
      avgGoals: 3.2,
      marketVolatility: 1.20,
      mcGlobal: 61
    }
  ]);
})();