import https from 'https';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  const d = await fetchUrl('https://halaldamu.kz/wp-json/halal-bot/v1/companies?lang=kz');
  
  const items = d.items;
  let active = 0;
  let expired = 0;
  let other = 0;
  
  for(const item of items) {
    if (item.certificate_status === 'active') active++;
    else if (item.certificate_status === 'expired') expired++;
    else other++;
  }
  
  console.log(`Active: ${active}, Expired: ${expired}, Other: ${other}`);
}
run();
