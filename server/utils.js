import accounting from 'accounting';


export function makeArray(val) {
    if(Array.isArray(val)) {
        return val;
    }
    if(val === null || val === undefined) {
        return [];
    }
    return [val];
}


export function formatPrice(price) {
    return price ? accounting.toFixed(price/100, 2) : price;
}


/*
* Creates a substring but does not break up words
*
* @param str The string to trim
* @param maxLen The maximum length to trim the string to
* @param suffix The suffix to append to the end of the string if it is trimmed.  Pass null to append nothing.
*/
export function substringOnWords(str, maxLen, suffix) {
   let cleanStr = str.trim();
   let end = (suffix === undefined ? '...' : '');
   let max = parseInt(maxLen, 10) || 25;
   let arr = cleanStr.length ? cleanStr.split(' ') : [];
   let words = [];
   let finalCount = 0;
   let forEachDone = false;

   arr.forEach((part, index) => {
       if(!forEachDone) {
           let pl = part.length;
           let lengthIncludingSpaces = index > 0 ? pl + 1 : pl;

           if(finalCount + lengthIncludingSpaces <= max) {
               words.push(part);
               finalCount += lengthIncludingSpaces;
           }
           else {
               forEachDone = true;
           }
       }
   });

   // If there is nothing in 'words' then the original string 'cleanStr'
   // had no spaces in it, so we'll just return the truncated 'cleanStr'
   if(!words.length) {
       return cleanStr.length > max ? cleanStr.substring(0, max) + end : cleanStr;
   }

   let done = words.join(' ');
   return (cleanStr.length > done.length ? done + end : done);
}
