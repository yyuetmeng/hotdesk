'use strict';
/*
 * Sample names for demo mode (npm run demo, DEMO_MODE=1, or ?demo on the page): the booking page
 * (/book) and the check-in page (/checkin) fill the name field with one of these at random.
 * The simulator (scripts/simulate.js) names its people from this list too, in order.
 */
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
];
/** Demo mode from the URL: ?demo turns it on, ?demo=0 off, otherwise null (follow the server). */
var demoFromUrl = (() => { const v = new URLSearchParams(location.search).get('demo'); return v === null ? null : v !== '0'; })();
/** A random sample name, different from `avoid`. */
function randomDemoName(avoid) {
  let n;
  do n = DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)]; while (n === avoid && DEMO_NAMES.length > 1);
  return n;
}
