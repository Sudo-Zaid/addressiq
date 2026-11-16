# -*- coding: utf-8 -*-
"""Normaliser: cleans text for MATCHING only (the original text is always stored unchanged).
Roman Urdu / Urdu script / English -> one lowercase ASCII form, number words -> digits, common spelling variants
-> one canonical spelling, and a phonetic key so that masjid / masjed / masjeed share one key."""
import re, unicodedata

URDU_WORDS = {  # Urdu script -> Roman (matching only)
    'مسجد': 'masjid', 'گلی': 'gali', 'محلہ': 'mohalla', 'محله': 'mohalla', 'کالونی': 'colony', 'ٹاؤن': 'town',
    'روڈ': 'road', 'سڑک': 'road', 'بازار': 'bazar', 'چوک': 'chowk', 'پلازہ': 'plaza', 'سکول': 'school', 'اسکول': 'school',
    'کالج': 'college', 'ہسپتال': 'hospital', 'پیچھے': 'peeche', 'سامنے': 'samne', 'ساتھ': 'sath', 'قریب': 'qareeb',
    'نزدیک': 'nazdeek', 'پاس': 'pass', 'مکان': 'makan', 'گھر': 'ghar', 'نمبر': 'no', 'جہلم': 'jhelum', 'دینہ': 'dina',
    'کے': 'ke', 'کی': 'ki', 'کا': 'ka', 'والا': 'wala', 'والی': 'wali', 'نزد': 'nazdeek', 'اسلام پورہ': 'islampura', 'اسلام پورا': 'islampura',
    'پورہ': 'pura', 'پورا': 'pura', 'آباد': 'abad', 'نگر': 'nagar', 'ہاؤسنگ': 'housing', 'سٹی': 'city', 'سیٹلائٹ': 'satellite',
    # common Jhelum / Dina place words (Urdu script drops short vowels, so spell them out explicitly)
    'بلال': 'bilal', 'مشین': 'machine', 'ماڈل': 'model', 'کینٹ': 'cantt', 'جی ٹی روڈ': 'gt road', 'غوثیہ': 'ghousia', 'جامعہ': 'jamia',
    'مدینہ': 'madina', 'قریشی': 'qureshi', 'فیصل': 'faisal', 'اقبال': 'iqbal', 'مجاہد': 'mujahid', 'سول لائنز': 'civil lines',
    'میزان': 'meezan', 'الائیڈ': 'allied', 'حبیب': 'habib', 'روہتاس': 'rohtas', 'فیضان': 'faizan', 'گورنمنٹ': 'govt', 'بوائز': 'boys',
    'گرلز': 'girls', 'ہائی': 'high', 'پرائمری': 'primary', 'ریلوے': 'railway', 'اسٹیشن': 'station', 'سٹیشن': 'station', 'ٹاور': 'tower',
    'ہاؤس': 'house', 'گیٹ': 'gate', 'ٹیولپ': 'tulip', 'شاہین': 'shaheen', 'عسکری': 'askari', 'لالہ زار': 'lalazar', 'گلشن': 'gulshan',
    'کالا گجراں': 'kala gujran', 'سرائے عالمگیر': 'sarai alamgir', 'منگلا': 'mangla', 'یونیورسٹی': 'university', 'اکیڈمی': 'academy',
    'بلاک': 'block', 'سیکٹر': 'sector', 'سٹریٹ': 'street', 'اسٹریٹ': 'street', 'جامع': 'jamia', 'شہر': 'city',
    'پارک': 'park', 'بینک': 'bank', 'ہوٹل': 'hotel', 'دکان': 'shop', 'مارکیٹ': 'market', 'مدرسہ': 'madrasa',
}
NUMBER_WORDS = {'ek': '1', 'aik': '1', 'do': '2', 'teen': '3', 'tin': '3', 'char': '4', 'chaar': '4', 'panch': '5', 'paanch': '5',
                'che': '6', 'chay': '6', 'chhe': '6', 'saat': '7', 'aath': '8', 'ath': '8', 'nau': '9',
                'das': '10', 'dus': '10', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
                'eight': '8', 'nine': '9', 'ten': '10'}
URDU_CHARS = {  # rough Urdu letter -> Roman fallback for words not in URDU_WORDS (matching only)
    'ا': 'a', 'آ': 'a', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ڈ': 'd',
    'ذ': 'z', 'ر': 'r', 'ڑ': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh',
    'ف': 'f', 'ق': 'q', 'ک': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n', 'و': 'o', 'ہ': 'h', 'ھ': 'h', 'ء': '', 'ی': 'i',
    'ے': 'e', 'ئ': 'i', 'ؤ': 'o', 'ۃ': 'h', '۔': ' ', '،': ' ', '؟': ' ', '٪': ' ', 'ً': '', 'ٌ': '', 'ٍ': '', 'َ': '', 'ُ': '', 'ِ': '', 'ّ': '', 'ْ': '',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}
CANON = {  # spelling variants -> canonical token (Roman Urdu is written many ways)
    'masjed': 'masjid', 'masjeed': 'masjid', 'maszid': 'masjid', 'mosque': 'masjid', 'jama': 'jamia', 'jame': 'jamia', 'jamiya': 'jamia',
    'gully': 'gali', 'gale': 'gali', 'galli': 'gali', 'st': 'street', 'str': 'street', 'rd': 'road', 'rode': 'road',
    'mohallah': 'mohalla', 'mohala': 'mohalla', 'muhalla': 'mohalla', 'muhallah': 'mohalla', 'colony': 'colony', 'kalony': 'colony',
    'kolony': 'colony', 'plazza': 'plaza', 'plaze': 'plaza', 'chok': 'chowk', 'chawk': 'chowk', 'chouk': 'chowk',
    'bazaar': 'bazar', 'bazzar': 'bazar', 'skool': 'school', 'iskool': 'school', 'hospitel': 'hospital', 'haspatal': 'hospital',
    'peechay': 'peeche', 'pichay': 'peeche', 'pichhe': 'peeche', 'pechay': 'peeche', 'peche': 'peeche', 'peechey': 'peeche', 'pichey': 'peeche',
    'saamne': 'samne', 'samnay': 'samne', 'saamnay': 'samne', 'samney': 'samne', 'opp': 'samne', 'opposite': 'samne', 'front': 'samne',
    'saath': 'sath', 'sathh': 'sath', 'sat': 'sath', 'paas': 'pass', 'pas': 'pass', 'qarib': 'qareeb', 'kareeb': 'qareeb', 'qareb': 'qareeb',
    'near': 'pass', 'nazdik': 'nazdeek', 'behind': 'peeche', 'next': 'sath', 'beside': 'sath', 'adjacent': 'sath',
    'hse': 'house', 'hno': 'house', 'makaan': 'makan', 'mkn': 'makan', 'ghr': 'ghar', 'num': 'no', 'number': 'no', 'nmbr': 'no', 'numbr': 'no',
    'jehlum': 'jhelum', 'jhelam': 'jhelum', 'jhlm': 'jhelum', 'jhelm': 'jhelum', 'deena': 'dina', 'dena': 'dina',
    'citi': 'city', 'citty': 'city', 'satelite': 'satellite', 'satalite': 'satellite', 'setelite': 'satellite',
    'housng': 'housing', 'hosing': 'housing', 'hussing': 'housing', 'blok': 'block', 'blck': 'block', 'sectr': 'sector',
}
PROTECT = re.compile(r'\b(\d+)\s*[-/]\s*([a-z])\b')          # 14-A, 14/A -> keep as one token 14a

def normalise(text: str) -> str:
    if not text: return ''
    t = unicodedata.normalize('NFKC', text)
    for ur, ro in sorted(URDU_WORDS.items(), key=lambda kv: -len(kv[0])): t = t.replace(ur, ' ' + ro + ' ')
    if re.search(r'[؀-ۿ]', t):
        t = ''.join(URDU_CHARS.get(ch, ch) for ch in t)
    t = t.lower()
    t = re.sub(r"[’'`\"]", '', t)
    t = PROTECT.sub(lambda m: m.group(1) + m.group(2), t)
    t = re.sub(r'(\d+)\s*(st|nd|rd|th)\b', r'\1', t)              # 3rd -> 3
    t = re.sub(r'[^\w\s]', ' ', t)
    t = re.sub(r'\b(\d+)\s*no\b', r'\1', t)                        # "gali 3 no" -> "gali 3"
    toks = []
    for w in t.split():
        w = NUMBER_WORDS.get(w, w)
        w = CANON.get(w, w)
        toks.append(w)
    t = ' '.join(toks)
    t = re.sub(r'\bno\s+(\d+)', r'\1', t)                          # "gali no 3" -> "gali 3"
    t = re.sub(r'\b(\d+)\s+no\b', r'\1', t)                        # "3 no gali"  -> "3 gali"
    t = re.sub(r'(?<!house )(?<!plot )(?<!flat )(?<!shop )(?<!makan )(?<!ghar )\b(\d+)\s+(gali|street|block|sector)\b', r'\2 \1', t)   # "3 gali" -> "gali 3"
    t = re.sub(r'\b(gali|street|block|sector|house|makan|plot|flat|shop|phase)\s*([a-z])\s*(\d+)\b', r'\1 \2\3', t)  # street a 8 -> street a8
    t = re.sub(r'\b(gali|street|block|sector|house|makan|plot|flat|shop|phase)\s*(\d+|[a-z])\b', r'\1 \2', t)
    t = re.sub(r'\bmakan\b', 'house', t); t = re.sub(r'\bghar\b', 'house', t)
    return re.sub(r'\s+', ' ', t).strip()

def phonetic_key(norm: str) -> str:
    """Cheap Roman-Urdu phonetic key: drop vowels after the first letter, collapse doubles, unify similar consonants."""
    out = []
    for w in norm.split():
        if w.isdigit(): out.append(w); continue
        w = re.sub(r'ph', 'f', w); w = re.sub(r'(ck|q)', 'k', w); w = re.sub(r'z', 's', w); w = re.sub(r'w', 'v', w)
        w = re.sub(r'(sh|ch|th|kh|gh|dh|bh)', lambda m: m.group(1)[0].upper(), w)
        w = w[0] + re.sub(r'[aeiouy]', '', w[1:])
        w = re.sub(r'(.)\1+', r'\1', w)
        out.append(w.lower())
    return ' '.join(out)

if __name__ == '__main__':
    for s in ['House 14, Gali 3, Jamia Masjid ke peeche, Islampura, Jhelum', 'Makan no 14-A, teen number gali, jama masjed k pichay, islam pura',
              'گلی نمبر 3، جامع مسجد کے پیچھے، اسلام پورہ، جہلم', 'Street A8, Satellite Town, Jhelum', 'Al Marjan plaza k sath, A block citi housing']:
        n = normalise(s); print(repr(s)); print('  ->', n, '|', phonetic_key(n))
