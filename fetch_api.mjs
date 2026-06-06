const https = require('https');

https.get('https://core.telegram.org/bots/api', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    if (data.toLowerCase().includes('draft')) {
      console.log('Found draft in API documentation');
      // print matching lines
      const lines = data.split('\n');
      lines.forEach((line, i) => {
         if (line.toLowerCase().includes('draft')) {
            console.log(line);
         }
      });
    } else {
      console.log('No mention of draft found.');
    }
  });
});
