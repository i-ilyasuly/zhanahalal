const https = require('https');

https.get('https://core.telegram.org/bots/api', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const startIdx = data.indexOf('name="sendmessagedraft"');
    if (startIdx !== -1) {
      console.log('Found sendMessageDraft:');
      // get 3000 chars after it
      console.log(data.substring(startIdx - 50, startIdx + 3000));
    }
  });
});
