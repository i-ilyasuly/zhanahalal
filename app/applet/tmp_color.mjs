import https from 'https';

https.get('https://core.telegram.org/bots/api', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const lines = data.split('\n');
    lines.forEach((l, i) => {
      if (l.toLowerCase().includes('color')) {
        console.log(`Line ${i}:`, l.trim().substring(0, 100));
      }
    });
  });
});
