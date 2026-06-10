const CYR_TO_LAT_BRAND: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e',
  'ж':'zh','з':'z','и':'i','й':'i',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
  'с':'s','т':'t','у':'u','ф':'f','х':'x','ц':'ts','ч':'ch',
  'ш':'sh','щ':'sch','ы':'y','э':'e','ю':'yu','я':'ya',
  'ә':'a','і':'i','ң':'n','ғ':'g','ү':'u','ұ':'u','қ':'q','ө':'o','һ':'h'
};

const NON_WORD_REGEX = /[^a-z0-9]/g;

export function cleanText(text: string): string {
  if (!text) return "";
  let s = String(text).toLowerCase();
  
  // Replace Cyrillic based on the reference table
  let result = "";
  for (const char of s) {
    result += CYR_TO_LAT_BRAND[char] || char;
  }
  
  // Remove non-alphanumeric
  return result.replace(NON_WORD_REGEX, "");
}

export function escapeHTML(text: string): string {
  if (!text) return "";
  let s = String(text);
  // Decode HTML entities that Telegram doesn't support natively
  s = s.replace(/&#038;/g, "&").replace(/&amp;/gi, "&");
  
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}
