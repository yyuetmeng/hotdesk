'use strict';
/*
 * Sample names for demo mode (npm run demo, DEMO_MODE=1, or ?demo on the page): the booking page
 * (/book) and the check-in page (/checkin) fill the name field with one of these at random.
 * The simulator (scripts/simulate.js) names its people from this list too, in order: it uses the first
 * SIMULATED_PEOPLE names, and the pages pick from the rest, so a name typed in on a page never belongs
 * to a simulated person (who could check in elsewhere and move "you" off your desk).
 */
var SIMULATED_PEOPLE = 70;
var DEMO_NAMES = [
  'Tan Wei Ming', 'Lim Hui Min', 'Lee Jia Hao', 'Ng Mei Ling', 'Wong Kai Xuan', 'Chua Li Ting', 'Goh Jun Jie', 'Teo Xin Yi',
  'Ong Zhi Hao', 'Koh Shu Fen', 'Chan Wen Jie', 'Low Pei Shan', 'Yeo Jian Wei', 'Sim Hui Ying', 'Chong Yi Xuan', 'Toh Kah Wai',
  'Ho Siew Ling', 'Seah Ming Hui', 'Quek Jia Ying', 'Tay Zheng Yang', 'Foo Li Na', 'Chew Boon Kiat', 'Heng Xiao Wen', 'Phua Kai Ling',
  'Soh Wei Jie', 'Kwek Mei Xuan', 'Liew Chee Keong', 'Pang Hui Wen', 'Yap Jun Wei', 'Loh Shi Min', 'Ang Yong Sheng', 'Tham Su Ling',
  'Neo Jia Le', 'Leong Wai Kit', 'Poh Xin Hui', 'Choo Wen Hao', 'Kang Li Xin', 'Tng Kok Leong', 'Gan Pei Yi', 'Lau Zhi Wei',
  'Huang Yi Ting', 'Zhang Wei', 'Wang Fang', 'Li Na', 'Liu Yang', 'Chen Jing', 'Yang Xiu Ying', 'Zhao Lei', 'Wu Min', 'Zhou Jie',
  'Lim Kok Wah', 'Tan Mei Hua', 'Ng Boon Huat', 'Wong Shu Ting', 'Lee Kai Wen', 'Goh Siew Mei', 'Teo Wei Lun', 'Ong Hui Shan',
  'Koh Jia Wei', 'Chan Li Ying', 'Low Kian Seng', 'Yeo Shu Hui', 'Sim Jun Hao', 'Toh Wan Ting', 'Seah Kok Meng', 'Quek Yi Ling',
  'Tay Hui Ling', 'Foo Chee Wai', 'Heng Bee Leng', 'Soh Jing Yi', 'Liew Kar Mun', 'Pang Wei Kiat', 'Yap Hui Qi', 'Loh Wen Xuan',
  'Ang Mei Qi', 'Neo Kheng Hwa', 'Leong Shi Ying', 'Poh Chin Wee', 'Kang Wen Qing', 'Gan Yong Jie',
  'Ho Jun Kai', 'Chia Hui Xin', 'Lam Wei Hong', 'Tio Shu Min', 'Kwan Zhi Xuan', 'Wee Li Lian', 'Ling Kai Jie', 'Siow Pei Wen',
  'Yong Jia Xin', 'Chin Wei Liang', 'Tang Hui Jun', 'Sng Kok Hua', 'Lai Mei Fong', 'Koay Jun Ming', 'Hee Shu Ling', 'Ting Wei Xiang',
  'Chiam Li Ping', 'Boey Kah Hin', 'Lum Xin Ru', 'Kok Wen Bin', 'Tee Siew Hoon', 'Eng Jia Hui', 'Fong Wai Leong', 'Mok Yi Hui',
  'Sia Zhen Yu', 'Hong Li Ting', 'Cheong Kai Lun', 'Tey Mei Yi', 'Woon Jun Yang', 'Pek Shi Hui',
];
/** Demo mode from the URL: ?demo turns it on, ?demo=0 off, otherwise null (follow the server). */
var demoFromUrl = (() => { const v = new URLSearchParams(location.search).get('demo'); return v === null ? null : v !== '0'; })();
/** A random sample name that no simulated person has, different from `avoid`. */
function randomDemoName(avoid) {
  const pool = DEMO_NAMES.slice(SIMULATED_PEOPLE);
  let n;
  do n = pool[Math.floor(Math.random() * pool.length)]; while (n === avoid && pool.length > 1);
  return n;
}
