/**
 * 离线生成引擎（provider=mock）。
 * 作用：没有 API Key 也能把 12 个环节完整跑一遍，界面、闸门、曲线、审稿报告都是真的，
 * 而不是写死的假数据 —— 度量、事实核对、去AI味都调用 text.js 的真实实现。
 *
 * 演示项目：东方玄幻·悬疑《照影》（长明灯 / 影子 / 替死）。
 */

import { countWords, splitParagraphs, hookScore, aiFlavor, similarity } from './text.js';

/* ------------------------------ 工具 ------------------------------ */

export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
const hash = (str = '') => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/* --------------------------- 演示世界 --------------------------- */

export const LAMP_WORLD = {
  premise: '这座城靠九千盏长明灯活着；灯照见的影子里，藏着一个日子。',
  era: '类明中后期：坊市、火禁、夜禁，纸灯与铜灯并行，无火器。',
  powerSystem: [{
    name: '照影术',
    unit: '灯芯',
    tiers: [
      '守灯：点灯、看影、记死期',
      '引灯：以灯引路，照出旧影',
      '灯官：借灯改命，一寸一命',
      '掌灯使：在灯阵中定生死',
      '燃身者：以身为灯，燃尽即亡',
      '影主：无灯亦能照影（传说）',
    ],
    rules: [
      '只有灯在燃烧时，照影术才生效；灯灭则术止。',
      '被照见影子的人，影子会留在灯芯上，七日内必死。',
      '替人续命，须有人自愿献出等长的寿数，且献寿者不知情。',
      '灯油以影为燃料：每照一次影，城中某处便有一盏灯灭。',
      '灯官不可自照其影；自照者所见死法必然成真。',
    ],
    cost: '每次改命一寸，烧掉自己一年的记忆，从最亲的人开始消失。',
    bounds: '不能复生死者，不能改变已发生的死因，只能推迟或转移。',
    exception: '大寒之夜九千盏灯同燃时，可在不移死因的前提下延寿一日；代价是当夜熄灭的灯永不重燃。',
  }],
  hardRules: [
    '灯不能在雨中点燃，点火者当夜必死。',
    '被照见影子的人七日内必死，除非有人替他挡影。',
    '灯官不可自照其影，自照者所见死法必然成真。',
    '替人续命必须有人自愿献寿，且献寿者不知情方有效。',
    '每照一次影，城中必有一盏灯灭，灯灭之处必有人死。',
  ],
  factions: [
    { name: '巡夜司', goal: '维持火禁与灯籍', resource: '灯籍册、巡夜差役、火禁门', weakness: '不敢动灯阵，怕全城失火', relation: '主角任职的最末一等衙门' },
    { name: '灯市行会', goal: '垄断灯油与影料', resource: '影料仓、私灯网络', weakness: '依赖巡夜司的默许', relation: '既是主角的货源，也是他的债主' },
    { name: '白衣观', goal: '主张灭火，回归黑暗', resource: '信众、对灯阵的破坏经验', weakness: '无法在夜里行动', relation: '中期的搅局者，可被利用' },
    { name: '提灯人', goal: '私下替人改命牟利', resource: '叛逃灯官、改命手法', weakness: '没有灯籍，见光即死', relation: '顾十的旧组织' },
  ],
  geography: [
    { name: '九重灯楼', feature: '九层，每层千盏，顶层无人上去过', danger: '第七层以上不对九品开放' },
    { name: '影巷', feature: '巷子两侧都是卖灯的人家', danger: '夜里影子会被墙吸走' },
    { name: '无灯坊', feature: '唯一没有灯的地方，住着等死的人', danger: '进去容易，出来难' },
    { name: '火禁门', feature: '出城必经，夜间落闸', danger: '闸落之后，没人在夜里开过' },
  ],
  society: '灯籍定人。有灯籍的才算城里人，灯籍按品分九等，九品以下称「灯奴」。火禁之后，无灯者不得行路，因此「借灯」成了穷人最贵的开销。',
  glossary: [
    { term: '长明灯', def: '以影为油的灯，全城定额九千盏，一盏灭则一人死。', type: '物件' },
    { term: '灯芯', def: '灯的芯，照过的影子会留在这里；芯上有人形，就代表那个人被照过。', type: '物件' },
    { term: '照影', def: '借灯看见一个人的影子，从而看见他的死期。', type: '体系' },
    { term: '影料', def: '压碎的旧灯芯，掺进灯油可延缓七日之期，黑市价高于人命。', type: '物件' },
    { term: '挡影', def: '让别人站在被照者的位置，替他接住死期。', type: '体系' },
    { term: '灯籍', def: '记载一个人属于哪盏灯的名册，改籍等于改命。', type: '称谓' },
    { term: '火禁门', def: '夜间落闸的城门，闸上有火漆，破闸者按纵火论。', type: '地点' },
    { term: '灯官', def: '有品级的守灯人，九品最低，三品以上称掌灯使。', type: '称谓' },
    { term: '燃身', def: '以身为灯，为全城续一日灯火，燃尽即亡。', type: '体系' },
    { term: '刻灯', def: '在灯身上刻名字，被刻者死期将至。', type: '体系' },
  ],
  taboo: ['夜里不数灯', '不喊死人的名字', '不照自己的影子'],
  openQuestions: [
    '为什么九千盏灯只在城南灭？',
    '影主是否真实存在？',
    '沈砚父亲的灯芯为什么一直不灭？',
  ],
};

export const LAMP_CHARACTERS = [
  {
    name: '沈砚', role: '主角', oneLine: '九品灯官，袖口永远沾着灯油，怕黑却每天点火',
    age: '二十七', look: '左手虎口有一道旧烫痕，像半枚灯焰',
    personality: ['死心眼', '记性好到伤人', '不会说软话'],
    rank: '九品灯官',
    motivation: '让妹妹沈菱活过这个月，哪怕要拿自己的记忆去换。',
    obstacle: '九品调不动一盏灯；改命需有人献寿，而他一个人也凑不齐。',
    misbelief: '只要照规矩办事，人就救得回来。',
    secret: '他小时候被父亲照过一次影，影子上的死期是空的。',
    turn: '为救妹妹，他亲手把不知情的醉汉推去挡影。',
    arcStart: '相信灯籍、规矩与报应。',
    arcEnd: '成了自己曾经最恨的那种灯官。',
    voice: '句子短，爱用生意人的算账说法；紧张时会数数。',
    relations: [
      { target: '沈菱', type: '血缘', tension: '妹妹的影子上有死期，而他不肯承认' },
      { target: '裴无咎', type: '上下级', tension: '他查的每一桩案子都通向裴无咎的灯籍册' },
      { target: '阿箬', type: '交易', tension: '他需要影料，她需要一盏不灭的灯' },
      { target: '谢知微', type: '共谋', tension: '对方手里有他妹妹三年前的死亡记录' },
    ],
  },
  {
    name: '裴无咎', role: '对手', oneLine: '三品掌灯使，指甲修得很干净，签过的灯籍能压死人',
    age: '四十六', look: '常年戴一枚铜灯戒，戒面磨得发亮',
    personality: ['有条理', '不动怒', '把人当数字'],
    rank: '三品掌灯使',
    motivation: '保住九千盏灯的定额，哪怕每年用一百个人做影料。',
    obstacle: '灯的数量在减少，而他不能让人知道。',
    misbelief: '只要总量不失衡，个体的死就不算错。',
    secret: '他年轻时亲手熄灭过第一百盏灯，从此学会了用别人填账。',
    turn: '大寒夜，他要在全城与一个人之间做选择，他选了全城——并且真的救了全城。',
    arcStart: '冷静的秩序维护者。',
    arcEnd: '秩序崩溃时，第一个把自己点成灯的人。',
    voice: '说话像念公文，喜欢用「定额」「账」；从不提高音量。',
    relations: [
      { target: '沈砚', type: '利用', tension: '他需要一个够干净的人去填城南的账' },
      { target: '顾十', type: '共谋', tension: '两人一起卖过延命，如今互相握着证据' },
    ],
  },
  {
    name: '阿箬', role: '盟友', oneLine: '灯市里卖私灯的姑娘，耳朵能听见灯芯里的声音',
    age: '十九', look: '右耳耳垂少了一块，说是被灯芯咬的',
    personality: ['利落', '嘴硬', '怕安静'],
    rank: '平民·灯市行会散户',
    motivation: '找到替她挡影的那个人，问一句为什么。',
    obstacle: '她是「本该死了七年」的人，不能报官，也不能照影。',
    misbelief: '只要不问，就还能当作自己活着。',
    secret: '七年前她的名字被人从灯籍上划掉，又被人加了回去。',
    turn: '她把唯一一盏能救命的灯，给了沈砚的妹妹。',
    arcStart: '只信钱和灯油价格。',
    arcEnd: '愿意为一件不划算的事站着不动。',
    voice: '爱抬价，爱骂人，句尾带「啊」「喂」；认真时反而说不出话。',
    relations: [
      { target: '沈砚', type: '交易', tension: '他欠她三壶影料，她欠他一条命' },
      { target: '老周', type: '亲缘', tension: '老周知道她为什么没死，但不说' },
      { target: '顾十', type: '仇怨', tension: '她怀疑是顾十划掉了她的名字' },
    ],
  },
  {
    name: '顾十', role: '镜像', oneLine: '叛逃灯官，四品出身，如今在影巷替富人改命',
    age: '三十九', look: '总是提两盏灯，一盏亮一盏灭',
    personality: ['讲究', '说实话', '不择手段'],
    rank: '前四品灯官',
    motivation: '证明规矩是给穷人守的，他要活到不用守规矩的那天。',
    obstacle: '没有灯籍，见光即死，只能在影巷里做买卖。',
    misbelief: '只要出价够高，任何代价都能外包。',
    secret: '他替裴无咎填过十七个人的账，账本在他手里。',
    turn: '最后他把账本交给沈砚，条件是沈砚替他点一次灯。',
    arcStart: '潇洒的卖家。',
    arcEnd: '被自己卖出去的死期追上。',
    voice: '总在算价，用「公道」「行情」；笑的时候不出声。',
    relations: [
      { target: '沈砚', type: '交易', tension: '他要沈砚的九品灯籍，沈砚要他的账本' },
      { target: '裴无咎', type: '共谋', tension: '两人互相握着对方填过的账' },
      { target: '阿箬', type: '仇怨', tension: '她的名字确实是他划的，为了十五两银子' },
    ],
  },
  {
    name: '老周', role: '导师', oneLine: '守九重灯楼四十年的灯奴，一条腿是假的',
    age: '六十二', look: '腰上挂着一串灯捻，走路有铜片声',
    personality: ['寡言', '护短', '记仇'],
    rank: '灯奴·无品',
    motivation: '守住第七层的门，别让上面的人下来。',
    obstacle: '他没有灯籍，说的话不算数。',
    misbelief: '只要门不开，旧事就追不上来。',
    secret: '全城的灯其实只剩八千九百盏，少的那些都在第七层。',
    turn: '他打开了第七层的门。',
    arcStart: '一个守着秘密的老人。',
    arcEnd: '亲手把秘密交出去的人。',
    voice: '话少，一次说半句；用「嗯」「成」回应。',
    relations: [
      { target: '沈砚', type: '师徒', tension: '他教沈砚点灯，却从不教他照影' },
      { target: '阿箬', type: '亲缘', tension: '他给她改了灯籍，又把她的名字抹掉' },
      { target: '沈菱', type: '照看', tension: '每天替她点一盏不记账的灯' },
    ],
  },
  {
    name: '谢知微', role: '变数', oneLine: '巡夜司录事，写字极小，记每一次死亡的地点与灯号',
    age: '三十三', look: '指节上有墨，袖口永远干净',
    personality: ['较真', '怕麻烦', '心软不承认'],
    rank: '七品录事',
    motivation: '把每一盏灭掉的灯和每一个人对上号，包括他自己的。',
    obstacle: '上司要他改记录，改一页换一次升迁，他一次没改。',
    misbelief: '只要记录是真的，世界就还有救。',
    secret: '他妹妹三年前死在城南，灯号是第一百盏。',
    turn: '他把三年前的卷宗交给沈砚，等于把自己的命也交了出去。',
    arcStart: '一个把自己藏在卷宗后面的人。',
    arcEnd: '站出来作证，被人从灯籍上划掉。',
    voice: '说话像念卷宗，爱补日期；紧张时会纠正别人的用词。',
    relations: [
      { target: '沈砚', type: '共谋', tension: '他们查的是同一桩事，但目的相反' },
      { target: '裴无咎', type: '上下级', tension: '他替裴无咎记了七年死亡，一次没改' },
    ],
  },
  {
    name: '沈菱', role: '变数', oneLine: '沈砚的妹妹，十七岁，笑起来像灯芯爆了一下',
    age: '十七', look: '手腕上系着一根烧过的灯捻',
    personality: ['安静', '执拗', '会替人疼'],
    rank: '灯籍·九品以下',
    motivation: '不想再让哥哥为她花灯油钱。',
    obstacle: '她的影子上有死期，而且那是三年前的日期。',
    misbelief: '哥哥什么都做得到。',
    secret: '她记得自己三年前死过一次，但没人信。',
    turn: '她要求哥哥别再救她。',
    arcStart: '被保护的人。',
    arcEnd: '选择自己走进灯阵的人。',
    voice: '话很轻，爱反问；着急时一句能说很长。',
    relations: [
      { target: '沈砚', type: '血缘', tension: '她越懂事，他越不肯放手' },
      { target: '老周', type: '照看', tension: '老周每天给她点一盏不记账的灯' },
      { target: '阿箬', type: '亲近', tension: '她羡慕阿箬能自己挣钱' },
    ],
  },
];

/** 12 章演示大纲（可扩展到任意章数：超出部分循环加料） */
const BEATS = [
  { title: '九品灯官', goal: '在雨夜巡完影巷的十二盏灯，别让任何一盏灭。', obstacle: '雨太大，灯罩进水；巷口有人在等死。', turn: '他在最后一盏灯的灯芯上，看见了妹妹的影子。', result: '妹妹的影子留在芯上，七日内必死。', density: 4, hookType: '悬念', hook: '灯芯里，妹妹的影子背对着他，慢慢转过了头。', scenes: ['影巷南口，雨夜巡灯', '巷尾遇见无影的尸体', '最后一盏灯前照影'], setup: ['无影尸', '父亲的灯芯'], payoff: [] },
  { title: '七日', goal: '去巡夜司调出妹妹的灯籍，确认真实死期。', obstacle: '谢知微不肯批，封卷要三品签押。', turn: '灯籍上的死期不是七日之内，而是三年前的今天。', result: '他确认妹妹本该在三年前就死，而有人替她挡过影。', density: 4, hookType: '信息缺口', hook: '案卷上的死亡日期，是三年前的今天。', scenes: ['巡夜司值房', '封卷库', '雨檐下对卷'], setup: ['三年前的旧案'], payoff: ['无影尸'] },
  { title: '影料', goal: '去灯市买影料，把七日之期往后拖。', obstacle: '行会只收活人抵押，阿箬不肯卖给他。', turn: '阿箬听出他的灯芯是空的，认出他是「没影的人」。', result: '他拿到半壶影料，欠下阿箬一个条件。', density: 3, hookType: '反转', hook: '阿箬说：你的影子，我七年前见过。', scenes: ['灯市夜市', '影料仓后门', '阿箬的灯摊'], setup: ['阿箬的旧影'], payoff: [] },
  { title: '挡影', goal: '找一个人替妹妹挡影，把死期接过去。', obstacle: '必须自愿，且不知情。', turn: '他选中了灯市口那个每次都多买一壶酒的醉汉。', result: '妹妹活了，醉汉当夜死在雨里。', density: 5, hookType: '反转', hook: '醉汉的影子里，站着沈砚的父亲。', scenes: ['灯市口', '影巷深处', '妹妹的房门', '雨夜的尸体'], setup: ['醉汉的影子'], payoff: ['父亲的灯芯'] },
  { title: '替死', goal: '把醉汉的死写成意外，应付巡夜司巡查。', obstacle: '谢知微查得极细，连灯号都要对。', turn: '尸体上留着灯官才有的烫印。', result: '他成了嫌疑人，灯籍被暂扣。', density: 2, hookType: '威胁', hook: '谢知微把卷宗合上：这枚印，只有九品以上盖得出来。', scenes: ['义庄', '巡夜司问话', '染坊后巷'], setup: ['灯官烫印'], payoff: [] },
  { title: '灯市夜话', goal: '找阿箬问父亲当年的事，顺便赊灯油。', obstacle: '阿箬只肯换不肯赊，且不信官差。', turn: '她听见灯芯里有人在叫沈砚的名字。', result: '两人结成临时的同盟。', density: 2, hookType: '情绪', hook: '阿箬捂着耳朵蹲下去，血从指缝里滴到灯油上。', scenes: ['灯摊', '影巷屋顶', '收灯的时辰'], setup: ['灯芯里的声音'], payoff: [] },
  { title: '三年前的记录', goal: '顺着卷宗找三年前城南那一百盏灯的记录。', obstacle: '记录被撕掉了十七页。', turn: '撕掉的那十七页，签名都是裴无咎。', result: '他第一次把矛头指向掌灯使。', density: 2, hookType: '信息缺口', hook: '第十七页上，父亲的名字被写作「燃身」。', scenes: ['封卷库', '灯楼底层', '抄录的夜'], setup: ['十七页账'], payoff: ['三年前的旧案'] },
  { title: '九千盏', goal: '混进灯楼数灯，确认城的灯还够不够。', obstacle: '第七层以上进不去，老周不让。', turn: '顾十出现，告诉他城里的灯只有八千九百盏。', result: '他知道了城的账早就亏空，而妹妹只是账上的一笔。', density: 5, hookType: '反转', hook: '顾十说：你要救的不是妹妹，是那一百盏灯的账。', scenes: ['灯楼七层', '楼梯间的交易', '城南空灯架'], setup: ['八千九百盏'], payoff: [] },
  { title: '大寒', goal: '在大寒夜之前拿到改命的灯阵位置。', obstacle: '白衣观要在当夜纵火，全城火禁。', turn: '阿箬的灯籍被人划掉，她开始消失。', result: '他必须在妹妹和阿箬之间选一个带进灯阵。', density: 4, hookType: '悬念', hook: '灯阵亮起的一瞬，他看见阵眼上站着自己。', scenes: ['白衣观前', '火禁门', '灯阵外圈'], setup: [], payoff: ['阿箬的旧影', '灯官烫印'] },
  { title: '灯阵', goal: '在灯阵里替妹妹改命一寸。', obstacle: '改命要献寿，而献寿者必须不知情。', turn: '裴无咎替他做了选择：用全城的灯换一个人。', result: '妹妹的七天之期被推迟，城南一百盏灯同时熄灭。', density: 5, hookType: '威胁', hook: '城南一百盏灯灭下去的时候，全城的人都听见了雨声。', scenes: ['九重灯楼顶层', '灯阵中心', '城南'], setup: [], payoff: ['十七页账'] },
  { title: '献寿', goal: '查清是谁替妹妹献了寿，把债还回去。', obstacle: '献寿者不知情，永远不会承认。', turn: '献寿的人是老周，他用自己的残余寿数抵了七年。', result: '老周死在第七层的门口，门开着。', density: 4, hookType: '情绪', hook: '老周的手还搭在门环上，铜片响了一声。', scenes: ['第七层门口', '灯楼', '灵前的灯'], setup: [], payoff: ['灯芯里的声音', '醉汉的影子'] },
  { title: '最后的灯', goal: '在大寒夜点亮第九千盏灯，让城继续活下去。', obstacle: '点灯的人必须燃身，全城只有他一个够格。', turn: '他照了自己的影，看见死法：被自己点亮的灯烧死。', result: '他点燃第九千盏灯，全城续命一日，妹妹活了下来。', density: 5, hookType: '悬念', hook: '灯亮起来的时候，妹妹的影子不见了。', scenes: ['灯楼顶', '全城灯阵', '雨停之后'], setup: [], payoff: ['八千九百盏'] },
];

const FORESHADOW_LEDGER = [
  { name: '无影尸', type: '物件', setupChapter: 1, payoffChapter: 12, content: '巷尾的尸首没有影子，巡夜差役只当是雨夜看不清。', payoff: '无影尸是被人挡过影的人，他的影子留在沈砚父亲的灯芯上。', risk: 'medium', midHint: 5 },
  { name: '父亲的灯芯', type: '物件', setupChapter: 1, payoffChapter: 12, content: '老周腰间挂着一枚不灭的旧灯芯，从不许人碰。', payoff: '那是沈砚父亲的灯芯，里面存着第九千盏灯的火。', risk: 'medium', midHint: 7 },
  { name: '三年前的旧案', type: '信息', setupChapter: 2, payoffChapter: 10, content: '灯籍上妹妹的死期是三年前的今天。', payoff: '三年前城南一百盏灯灭，是为了给沈菱挡影。', risk: 'low', midHint: 7 },
  { name: '阿箬的旧影', type: '关系', setupChapter: 3, payoffChapter: 9, content: '阿箬没有影子，摊子底下却压着一张旧灯籍。', payoff: '她的名字被划掉又写回，她是被挡影后活下来的人。', risk: 'medium', midHint: 6 },
  { name: '醉汉的影子', type: '关系', setupChapter: 4, payoffChapter: 11, content: '醉汉死时，影子朝向他家。', payoff: '醉汉的影子里站着沈砚的父亲，父亲一直在替人挡影。', risk: 'high', midHint: 8 },
  { name: '灯官烫印', type: '物件', setupChapter: 5, payoffChapter: 9, content: '尸体上有一枚九品以上的烫印。', payoff: '烫印来自九重灯楼第七层，是老周盖的。', risk: 'low', midHint: 7 },
  { name: '灯芯里的声音', type: '台词', setupChapter: 6, payoffChapter: 11, content: '阿箬听见灯芯里有人叫沈砚的名字。', payoff: '是沈砚父亲的声音，他被燃身时留了一缕在灯芯里。', risk: 'medium', midHint: 8 },
  { name: '八千九百盏', type: '信息', setupChapter: 8, payoffChapter: 10, content: '顾十说城里的灯只有八千九百盏。', payoff: '少的那一百盏，都在第七层，是替人挡影的成本。', risk: 'low', midHint: 9 },
  { name: '火禁门', type: '规则例外', setupChapter: 5, payoffChapter: 9, content: '火禁门的闸上有火漆，破了按纵火论。', payoff: '大寒夜闸被白衣观撞开，雨中起火，点火者当夜必死。', risk: 'medium', midHint: 8 },
];

/* --------------------------- 各环节 mock --------------------------- */

export function mockMarket(project) {
  const genre = project.brief?.genre || '东方玄幻';
  const r = makeRng(hash(genre));
  const variants = {
    东方玄幻: [
      ['灯官志怪（官署+怪谈）', 82, 'rising', 'low', '读者要的是「有条文的怪力乱神」，规则越清楚越上瘾'],
      ['师门内斗+权谋', 74, 'stable', 'high', '存量读者大，但开篇同质化严重'],
      ['底层小吏升级', 88, 'rising', 'medium', '代入感强，爽点来自「越级办事」'],
      ['器修/匠人体系', 63, 'stable', 'low', '小众但忠诚，需要真懂手艺细节'],
      ['民俗恐怖+悬疑', 79, 'rising', 'medium', '与短剧受众重合，开头三章压力大'],
      ['长生/寿数交易', 71, 'stable', 'medium', '情感浓度高，容易写出“替死”名场面'],
    ],
    悬疑: [
      ['社会派推理', 68, 'stable', 'medium', '慢热，靠结局口碑'],
      ['民俗怪谈', 84, 'rising', 'medium', '场景感优先，读者接受度高'],
      ['双线追凶', 72, 'stable', 'high', '结构成熟，难出新'],
      ['身份错位', 76, 'rising', 'low', '反转密度要求高'],
      ['密闭空间', 61, 'cooling', 'high', '短篇思维，长篇易疲'],
    ],
  };
  const pool = variants[genre] || variants['东方玄幻'];
  const items = pool.map(([g, heat, trend, saturation, note]) => ({
    genre: g,
    heat,
    trend,
    saturation,
    readerWant: note.split('，')[0],
    note,
    sources: ['本地演示数据（mock）', '题材轮动经验库'],
  }));
  return {
    mode: 'estimated',
    insight: '当前「官署/规则型怪谈」处于上升期：读者吃「有明确条文」的超自然设定。最大的坑是把规则写成设定集，开篇三章没有具体案件。',
    items,
    avoid: ['无名门派的师门恩怨开局', '主角一睁眼就天赋异禀', '反派为了坏而坏、没有账本'],
    updatedAt: new Date().toISOString(),
  };
}

export function mockTopics(project) {
  const seed = project.brief?.seedIdea || '长明灯';
  const r = makeRng(hash(seed + (project.brief?.genre || '')));
  const base = [
    {
      title: '九千盏',
      logline: '一个九品灯官发现妹妹的影子在三年前就该死了，为了让影子重新亮起来，他必须去数这座城的灯。',
      coreConflict: '救一个人，还是保住让全城活着的灯。',
      promise: '每一条规则都能要人命：读者会跟着主角一条条试探、一条条付账。',
      differentiation: '把「改命」做成会计活：每一次续命都有账、有成本、有经手人签字。',
      audience: '喜欢规则流、官署怪谈、道德困境的男频读者，25-35 岁。',
      heat: 84, novelty: 82, risk: 38,
    },
    {
      title: '替死者',
      logline: '灯市小贩以替人挡影为生，直到她发现所有客户的名字都出自同一本灯籍。',
      coreConflict: '赚钱的手艺，正好是别人杀人灭口的手套。',
      promise: '第三人称限知+黑市交易细节，开篇就是一次失败的挡影。',
      differentiation: '主角是服务提供方而不是受害者，视角在「产业链」上。',
      audience: '偏悬疑、喜欢灰色主角的读者。',
      heat: 76, novelty: 88, risk: 52,
    },
    {
      title: '灯下无影',
      logline: '巡夜司录事记录每一桩死亡，直到他发现自己七年前就死在记录里。',
      coreConflict: '一个死人要不要继续履行公务。',
      promise: '档案体叙事 + 逐页翻案，每章一封卷宗。',
      differentiation: '结构创新：正文与卷宗互文，读者可以自己查案。',
      audience: '女频悬疑与档案爱好者。',
      heat: 70, novelty: 92, risk: 61,
    },
    {
      title: '影料行情',
      logline: '灯油商人把人的影子压成燃料，直到他把自己的影子卖了。',
      coreConflict: '价格体系与自我价值的对撞。',
      promise: '极致的市井质感，钱数、斤两、赊账都写得清楚。',
      differentiation: '以经济体系为骨架，冲突由价格推动，而不是武力。',
      audience: '喜欢《长安的荔枝》式基层执行故事的读者。',
      heat: 68, novelty: 90, risk: 58,
    },
    {
      title: '自照者',
      logline: '灯官不能照自己的影子，因为看见死法就必然成真——而有人天天照，还活着。',
      coreConflict: '规则的例外，是祝福还是陷阱。',
      promise: '一个极简规则衍生出无限变体，适合连载解谜。',
      differentiation: '单一规则、极限推演，像解谜游戏一样写。',
      audience: '规则怪谈核心受众、设定党。',
      heat: 81, novelty: 79, risk: 44,
    },
  ];
  const topics = base.map((t) => ({
    ...t,
    total: Number((t.heat * 0.3 + t.novelty * 0.4 + (100 - t.risk) * 0.3).toFixed(1)),
    riskNote: t.risk > 55 ? '设定门槛高，前两章必须用一个具体案件把规则讲透，否则读者流失。' : '主要风险是同题材跟风变多，需要在书封与前三章强化「账本」这个独特记忆点。',
    id: `t_${hash(t.title).toString(36)}`,
  }));
  return {
    topics,
    recommendation: `推荐《${topics.sort((a, b) => b.total - a.total)[0].title}》：热度与创新同时在线，且「规则可审核」这一点能直接转化成阅读快感。执行上，前三章必须让读者学会三条规则并看见一次违规的代价。`,
    generatedAt: new Date().toISOString(),
  };
}

export function mockDedup(project, corpus) {
  const topic = project.topics?.find((t) => t.id === project.selectedTopicId) || project.topics?.[0];
  const text = [topic?.title, topic?.logline, topic?.coreConflict, topic?.differentiation].join(' ');
  const scored = corpus.map((c) => ({ ...c, sim: similarity(text, `${c.title} ${c.text}`) }))
    .sort((a, b) => b.sim - a.sim);
  const top = scored.slice(0, 3).map((c, i) => ({
    title: c.title,
    author: c.author,
    similarity: Number(Math.max(0.06, c.sim * (1 - i * 0.12)).toFixed(2)),
    overlapFacets: i === 0 ? ['力量体系', '主角身份'] : ['题材框架'],
    detail: i === 0 ? '同为「以寿命/记忆为代价的超自然官署体系」，但代价机制与账本结构不同。' : '共享题材框架，但切口不同。',
    suggestion: i === 0 ? '把代价从「寿命」换成「记忆的具体内容」（最亲的人先消失），并让账本成为主要道具。' : '无需改动，注意专有名词不要撞词。',
  }));
  const maxSim = top[0]?.similarity || 0;
  const verdict = maxSim > 0.72 ? 'duplicate' : maxSim > 0.45 ? 'risky' : 'safe';
  return {
    verdict,
    score: Math.round((1 - maxSim) * 100),
    matches: top,
    mustChange: verdict === 'safe' ? [] : ['把核心代价机制换成非寿命类（记忆/关系/身份）', '更换组织名与力量体系通名'],
    advice: verdict === 'safe' ? '可以推进：与参考库仅共享题材框架。' : '改后再推进：核心机制仍与参考库接近。',
  };
}

export function mockWorld(project) {
  const seed = `${project.brief?.seedIdea || ''}${project.brief?.genre || ''}`;
  if (/灯|影|玄幻|怪谈|悬疑/.test(seed)) return JSON.parse(JSON.stringify(LAMP_WORLD));
  return JSON.parse(JSON.stringify(LAMP_WORLD));
}

export function mockCharacters() {
  return {
    characters: JSON.parse(JSON.stringify(LAMP_CHARACTERS)),
    network: '沈砚在中心：向上被裴无咎的账本牵住，向下被妹妹与老周拉住，侧翼是阿箬的交易和顾十的账。',
    conflictMatrix: [
      { a: '沈砚', b: '裴无咎', stake: '城南一百盏灯的账该由谁填' },
      { a: '沈砚', b: '顾十', stake: '九品灯籍与十七页账本' },
      { a: '阿箬', b: '顾十', stake: '七年前被划掉的灯籍' },
      { a: '老周', b: '裴无咎', stake: '第七层的门开不开' },
    ],
    pov: '第三人称限知，跟沈砚；每卷最后一章切阿箬一次，用于揭示主角看不到的账。',
  };
}

export function buildOutline(project) {
  const target = Math.max(6, Number(project.brief?.targetChapters || 12));
  const words = Number(project.brief?.wordsPerChapter || 2400);
  const perVolume = Math.ceil(target / 3);
  const chapters = [];
  for (let i = 0; i < target; i++) {
    const b = BEATS[i % BEATS.length];
    const round = Math.floor(i / BEATS.length);
    chapters.push({
      no: i + 1,
      title: round === 0 ? b.title : `${b.title}·续`,
      goal: b.goal,
      obstacle: b.obstacle,
      turn: b.turn,
      result: b.result,
      density: b.density,
      hook: b.hook,
      hookType: b.hookType,
      scenes: b.scenes,
      words,
      foreshadow: {
        setup: round === 0 ? b.setup : b.setup.map((s) => `${s}·${round + 1}`),
        payoff: round === 0 ? b.payoff : b.payoff.map((s) => `${s}·${round + 1}`),
      },
    });
  }
  const volumes = [1, 2, 3].map((v) => {
    const slice = chapters.slice((v - 1) * perVolume, v * perVolume);
    if (!slice.length) return null;
    return {
      no: v,
      title: ['影子上的日子', '账本与灯市', '大寒夜'][v - 1] || `第${v}卷`,
      goal: [
        '搞清楚妹妹影子上那个日子的来由，同时不丢饭碗。',
        '顺着城南一百盏灯的账，摸到掌灯使的手。',
        '在大寒夜之前，决定用谁的命去点第九千盏灯。',
      ][v - 1] || `第 ${v} 卷主线目标`,
      endState: [
        '他替妹妹挡了影，也第一次杀了人。',
        '账本到手，灯籍被扣，妹妹与阿箬只能救一个。',
        '第九千盏灯亮起，城活了下来，他成了灯本身。',
      ][v - 1] || `第 ${v} 卷末不可逆变化`,
      arcs: [{
        no: 1,
        title: `第 ${v} 卷主弧`,
        summary: `第 ${slice[0].no}-${slice[slice.length - 1].no} 章：${slice[0].goal}`,
        chapters: slice,
      }],
    };
  }).filter(Boolean);
  return {
    logline: '一个只会照规矩办事的九品灯官，为了让妹妹的影子重新亮起来，把自己变成了账本上的一笔。',
    theme: '规矩保护的是账，不是人；但守过规矩的人，才有资格改账。',
    volumes,
    causalityCheck: [
      '第 1 章结尾看见妹妹的影子 → 第 2 章去调灯籍',
      '第 2 章发现死期在三年前 → 第 3 章去买影料拖延',
      '第 3 章认识阿箬 → 第 4 章有渠道找到替死者',
      '第 4 章挡影成功但留下烫印 → 第 5 章被谢知微盯上',
      '第 7 章查到十七页账 → 第 8 章才敢进灯楼数灯',
    ],
  };
}

export function mockPacing(project) {
  return { computed: true };
}

export function mockForeshadow(project) {
  const chapters = flatChapters(project.outline);
  const target = chapters.length;
  const acc = new Map();
  const touch = (name, field, no) => {
    if (!name) return;
    if (!acc.has(name)) acc.set(name, { setup: [], payoff: [] });
    acc.get(name)[field].push(no);
  };
  for (const c of chapters) {
    for (const n of c.foreshadow?.setup || []) touch(n, 'setup', c.no);
    for (const n of c.foreshadow?.payoff || []) touch(n, 'payoff', c.no);
  }
  const ledger = [...acc.entries()].map(([name, v], i) => {
    const detail = FORESHADOW_LEDGER.find((f) => f.name === name) || {};
    const setupChapter = Math.min(...v.setup, target);
    const payoffCandidates = v.payoff.filter((n) => n > setupChapter);
    const payoffChapter = payoffCandidates.length ? Math.min(...payoffCandidates) : Math.min(target, setupChapter + 4);
    return {
      id: `f${i + 1}`,
      name,
      type: detail.type || '信息',
      setupChapter,
      payoffChapter,
      content: detail.content || `第 ${setupChapter} 章以细节形式出现，读者只当寻常。`,
      payoff: detail.payoff || `第 ${payoffChapter} 章揭示它的真实用途。`,
      risk: detail.risk || 'medium',
      midHint: setupChapter + Math.max(1, Math.round((payoffChapter - setupChapter) / 2)),
      status: 'planned',
    };
  }).filter((f) => f.payoffChapter > f.setupChapter);
  const hooks = chapters.map((c) => ({ chapter: c.no, hookType: c.hookType, line: c.hook }));
  return {
    ledger,
    hooks,
    balance: `全书 ${ledger.length} 条伏笔，约每 ${(target / Math.max(ledger.length, 1)).toFixed(1)} 章一条；前 3 章布置 ${ledger.filter((f) => f.setupChapter <= 3).length} 条、回收 ${ledger.filter((f) => f.payoffChapter <= 3).length} 条，符合「先给细节、后给答案」的节奏。`,
  };
}

export function flatChapters(outline) {
  const out = [];
  for (const v of outline?.volumes || []) for (const a of v.arcs || []) for (const c of a.chapters || []) out.push(c);
  return out.sort((a, b) => a.no - b.no);
}

/* --------------------------- 正文生成 --------------------------- */

const OPENERS = [
  (v) => `雨从戌时下起，${v.place}的灯一盏接一盏亮上去，像有人在黑布上戳出的小孔。${v.who}把灯罩掀开半指宽，让风进去一点，火苗贴着芯子抖了抖，没灭。`,
  (v) => `${v.place}的墙上挂着十二盏灯，今晚只剩九盏亮着。${v.who}数了两遍，把手指从第九盏挪开，没敢再数。数灯这件事，夜里不能做。`,
  (v) => `火禁的锣敲过三下，${v.place}静得能听见灯芯吸油的声响。${v.who}提着灯走过来，鞋底在石板上留下一串湿印，走几步就淡了。`,
  (v) => `${v.place}有个规矩：灯灭了不许喊，只能站着等。${v.who}站了半炷香，等到灯芯自己重新亮起来，才发现手心全是汗。`,
  (v) => `${v.who}到${v.place}的时候，雨已经小了些，屋脊上还在滴水。他把灯挂在门边的铁钩上，先从袖子里摸出巡夜册，翻到今天这一页。`,
  (v) => `${v.place}的门半开着，里面有人在收拾东西。${v.who}在门槛外站了一会儿，听见算盘珠子响了两下，又停了。他没有立刻进去。`,
  (v) => `这一夜的风是从城南过来的，带着一点焦味。${v.who}把灯举高了些，光扫过${v.place}的墙根，那里蹲着一只湿透的猫，见了光也不跑。`,
  (v) => `${v.place}的灯要一盏一盏点，顺序不能乱。${v.who}按老规矩从东头开始，点到第七盏时手停在半空——灯芯是干的，油却是满的。`,
  (v) => `灯油只剩半壶。${v.who}掂了掂，把壶塞回去，推门进了${v.place}。屋里没人应声，只有灯芯在轻轻地响，像有人在很远的地方磨牙。`,
  (v) => `${v.place}的青砖上有一道新划痕，像是被什么拖过。${v.who}蹲下去看了看，把灯凑近，没看出什么，还是先记在了册子上。`,
];

const ACT_VERBS = [
  '蹲下去', '直起腰', '把手缩回袖子里', '把灯往前递了递', '用袖子擦了两下灯罩',
  '数了数腰上的灯捻', '把灯芯拨高一点', '退到墙根', '把门推开半扇', '把巡夜册翻到第三页',
  '把灯挂在铁钩上', '在门槛上磕了磕鞋底的泥',
];
const ACT_OBJECTS = [
  '灯罩上的油污', '墙上的一道裂缝', '被油浸透的半张纸', '腰牌上快磨平的刻字',
  '门槛下积着的水', '门缝里透出来的光', '灯芯上那个小黑点', '桌上摊开的账册',
  '墙角一只翻倒的灯座', '屋梁上垂下来的灯绳',
];
const ACT_DETAILS = [
  '指节上沾了一层灯油，蹭在衣襟上，蹭不掉。', '火光把影子拉得很长，一直拖到对面的墙上。',
  '雨声在屋檐外连成一片，把屋里衬得更静。', '远处有人咳嗽了两声，很快又静了下去。',
  '铜片响了一下，就没有再响。', '他数到七，停住，没有往下数。',
  '灯焰歪了一下，又立住，像是在犹豫。', '空气里有一股冷掉的油烟味，压在喉咙口。',
];

const DIALOGUE_SETS = [
  (v) => [
    `「灯籍呢？」${v.other}问。`,
    `${v.who}把腰牌解下来，放在桌上，牌子上刻着的「九」磨得快看不清了。`,
    `「九品，」${v.other}扫了一眼，「九品不该来这儿。」`,
    `「我妹妹的名字在册子上，」${v.who}说，「我来对一下。」`,
  ],
  (v) => [
    `「你买影料做什么？」${v.other}把灯往柜台上一搁。`,
    `「续日子。」`,
    `「续谁的日子？」`,
    `${v.who}没答。柜台上的灯芯爆了一下，火星子落在木头上，很快就黑了。`,
  ],
  (v) => [
    `「城里有多少盏灯？」${v.who}问。`,
    `${v.other}笑了笑，伸出一只手，又收回去，只留下一根手指。`,
    `「九千。」`,
    `「你少说了一百。」`,
    `${v.other}的手停在半空，没有放下来。`,
  ],
  (v) => [
    `「规矩是给谁定的？」${v.who}问。`,
    `「给交得起灯油钱的人。」${v.other}答得很快，像是早就在等这句问话。`,
    `「交不起的呢？」`,
    `「交不起的，」${v.other}把灭掉的那盏灯提起来，「就是灯油。」`,
  ],
  (v) => [
    `「你别再为我买影料了。」${v.other}说，声音很轻。`,
    `${v.who}正在擦灯，手停了一下，接着擦。`,
    `「哥。」`,
    `「灯还没灭。」他说，「先把灯擦干净。」`,
  ],
  (v) => [
    `${v.other}把卷宗推过来，手指压在同一条上，压了很久。`,
    `「这页你看了？」`,
    `「看了。」`,
    `「看完就当没看，」${v.other}说，「有些日子，写上去是让人安心，不是让人查。」`,
  ],
  (v) => [
    `「这一盏，谁批的？」${v.who}问。`,
    `「上头。」${v.other}没有抬头，笔尖在纸上划了一下，「你要问，别在我这儿问。」`,
    `「上头是谁？」`,
    `${v.other}把笔放下，看着他，什么也没说，只把袖口往下拉了拉。`,
  ],
  (v) => [
    `「灯灭了几盏？」`,
    `「三盏。」`,
    `「人呢？」`,
    `${v.other}把算盘往上一推，珠子归位，声音很脆。「你数人，我数灯。别弄混了。」`,
  ],
  (v) => [
    `${v.who}把灯往前推了推，火光照到对方手背上。`,
    `「你的手怎么这么凉？」`,
    `「在外头站得久了。」${v.other}把手收回去。`,
    `「站了多久？」`,
    `「从灯亮到灯灭。」`,
  ],
  (v) => [
    `「你要的是账，还是人？」${v.other}问。`,
    `「我要我妹妹活着。」`,
    `「那是两码事。」`,
    `${v.who}没有反驳。他知道对方说得对，这正是最难受的地方。`,
  ],
  (v) => [
    `「今晚别点第九盏。」${v.other}忽然说。`,
    `「为什么？」`,
    `「点了就得有人来填，填谁不是填。」`,
    `${v.who}把火折子握在手里，握得发烫，没有点。`,
  ],
  (v) => [
    `${v.other}从抽屉里摸出一张旧纸，边角被油浸得发亮。`,
    `「这名字你认得？」`,
    `${v.who}看了很久，才说：「这是我父亲的字。」`,
    `${v.other}把纸收回去，折得很小，塞进袖子里。`,
  ],
];

const INNER = [
  (v) => `${v.who}在心里算了一笔账：一壶影料拖七日，七日的灯油要十二文，他手上还有三十七文。算到第三遍，数字没变，人也没活过来。`,
  (v) => `他想起小时候父亲教他点灯，说点灯不难，难的是记住哪一盏不能点。那时候他以为这只是一句手艺上的话，如今才知道是遗言。`,
  (v) => `规矩写在灯籍册的第三页，他背得出来。可册子上没写：如果规矩要你妹妹死，你该怎么办。这一条，得自己拿命去填。`,
  (v) => `${v.other}的话在他脑子里转了两圈。他不敢深想，因为一深想就要承认：他已经在按那人的话做事了。`,
  (v) => `灯照着他的手背。手背上的旧烫痕像半枚灯焰，每次点火都会隐隐发烫。老周说过，烫痕发烫，说明有人的影子正在靠近。`,
  (v) => `他可以现在就走。走出${v.place}，回值房，把册子交上去，明天照常巡灯。这个念头只活了一息，就被他自己掐了。`,
  (v) => `九品一个月三百二十文，影料一壶要九十文。他从来没算过这么清楚的账，今晚算了两遍，还是不敢往第三遍上算。`,
  (v) => `他忽然想起，妹妹小时候怕黑，总要留一盏灯。那时候他嫌她费油，现在他愿意把整壶油都倒进去，只要她还能嫌。`,
  (v) => `灯芯上的黑点又大了一点。他盯着那个点看，觉得它也在看他。这念头很蠢，但他没有说服自己。`,
  (v) => `如果有一盏灯注定要灭，是先救灯，还是先救人？巡夜司的册子上没有这一条，翻到最后一页也没有。`,
  (v) => `他见过城南的人怎么死。不是被什么咬死，也不是被杀，就是灯灭了，然后第二天早上，名字被人用朱笔划掉。`,
  (v) => `父亲说过，灯官这一行做的不是救人，是记账。谁该走，谁还能留，都要有人落笔。落笔的人，手不能抖。`,
  (v) => `他忽然意识到，今天晚上问的每一句话，对方都答得比自己快。这不正常。要么对方早有准备，要么对方根本不在乎他问什么。`,
  (v) => `九品也有九品的好处：没人指望你办事，也就没人盯着你。他今晚第一次觉得，这好处大概是假的。`,
];

const SENSORY = [
  (v) => `屋里的温度比外头低。${v.who}把手掌贴在灯罩上，热从掌心一直走到手腕，才觉得自己还活着。`,
  (v) => `灯油有一股说不清的味道，像放久了的鱼，又像铁锈。闻久了嘴里会发苦。${v.who}已经闻了十年，还是会在某个夜里觉得恶心。`,
  (v) => `雨点砸在瓦上，声音一开始是散的，后来连成一片，把人的念头都压平了。${v.who}在这种声音里站了很久，久到忘了自己在等什么。`,
  (v) => `影子在墙上晃。有两个是他自己的，一个深，一个浅。他知道浅的那个不是，但他没有回头。`,
  (v) => `巷子尽头的灯灭了。没有风，也没有人碰它。${v.who}听见很轻的一声响，像有人在很远的地方合上一本书。`,
  (v) => `门缝里透出来的光把地面切成一条一条。${v.who}踩在光上，脚底是暖的，心里不是。他往前走了两步，站在了光的外面。`,
  (v) => `${v.place}的墙皮一碰就掉。${v.who}用指甲刮了一下，露出里面更深的一层，黑色的，凑近了能闻到一点焦味。`,
  (v) => `他把灯举过头顶，光往上走，照见屋梁上挂着的一串旧灯捻，每一根都打了结。结的数目他不敢数。`,
  (v) => `冷是从袖口进去的。${v.who}把两只手拢在灯边，热只到指节，再往里就走不动了。他就这么拢着，直到手指开始发麻。`,
  (v) => `${v.other}身上有一股灯油混着药的味道。离得近了才闻得出，离得远就只有雨水的腥气。`,
];

const TURNS = [
  (v) => `就在他准备吹灯的时候，灯芯里浮出一个人形。不是他的。那影子很小，肩膀窄，手腕上系着一根烧过的灯捻。${v.who}整个人僵住，连呼吸都放轻了，好像声音一大，影子就会散。`,
  (v) => `${v.other}忽然伸手，把灯芯按进油里。火灭了。屋里黑得没有边界。${v.who}听见自己的心跳，也听见黑暗里有人轻轻地、很确定地，念了一遍他的名字。`,
  (v) => `他翻开卷宗，一页一页往下揭。日期对得上，灯号对得上，只有一处不对：死亡日期那一栏，写的是三年前的今天。纸上的墨已经发灰，像是不打算让谁看见。`,
  (v) => `${v.other}把灭掉的那盏灯递过来。灯身内侧刻着一行小字，笔画很细。${v.who}凑近了才看清，那是他父亲的名字，后面还跟着两个字：燃身。`,
  (v) => `雨声忽然停了一瞬。${v.place}所有的灯同时暗了一下，又亮起来。${v.who}数了数，从第一盏到第十二盏，每一次暗下去，都有一盏没能再亮。`,
  (v) => `${v.who}把腰牌翻过来，背面有一道新鲜的划痕，像是被人用刀尖试过。他抬头，${v.other}正看着他，眼里没有惊讶，只有一点不耐烦。`,
  (v) => `门外有人敲了三下，停一停，又敲两下。${v.who}认得这个敲法，巡夜司报丧的规矩。他没有开门，先把手里的灯吹灭了。`,
  (v) => `${v.who}打开册子，发现今晚自己写的那一页，墨还是湿的，字却已经变了——「九品」两个字被人添了一笔，成了「三品」。`,
];

const AI_FILLERS = [
  (v) => `火光在墙上缓缓地移动，影子仿佛也跟着晃了一下。${v.who}似乎听见了什么，又似乎什么都没听见，心里不禁有些发紧。`,
  (v) => `${v.other}微微侧过脸，眼底闪过一丝不易察觉的情绪，仿佛早已知道他要说什么。屋里顿时安静下来。`,
  (v) => `空气仿佛凝固了。${v.who}缓缓抬起头，那一点灯火映在他眼里，像一粒随时会熄灭的星。他心中暗道，今晚怕是过不去了。`,
  (v) => `他顿时觉得，这世上的事仿佛都有一条看不见的线，牵着人往前走。${v.who}不禁握紧了手里的灯，指节微微发白。`,
  (v) => `${v.who}心中顿时一凛，仿佛有一只手从背后伸过来，轻轻搭在他的肩上。空气瞬间凝固，连雨声都听不见了。`,
  (v) => `他缓缓地吐出一口气，仿佛要把胸腔里那点东西一起吐出去。${v.other}没有看他，只是微微点了点头，神色里带着一丝说不清的意味。`,
];

const CLOSERS = ['他站在灯前，没有动。', '雨又下起来了。', '灯还亮着。'];

function castFor(project, card) {
  const chars = project.characters || [];
  const names = chars.map((c) => c.name);
  const lead = chars.find((c) => c.role === '主角')?.name || names[0] || '他';
  const others = names.filter((n) => n !== lead);
  const r = makeRng(hash(`cast-${card.no}`));
  return { lead, other: others[Math.floor(r() * others.length)] || '那人', all: names };
}

function sceneVars(card, project, cast, r) {
  // 地点优先取世界观里的短地名（影巷 / 灯市 / 无灯坊），避免把场景长句当地点用
  const geo = (project.world?.geography || []).map((g) => g.name).filter(Boolean);
  const place = geo.length ? geo[Math.floor(r() * geo.length)] : '影巷';
  return {
    who: cast.lead,
    other: cast.other,
    place,
    goal: card.goal,
    obstacle: card.obstacle,
    turn: card.turn,
    result: card.result,
  };
}

/** 组一个「动作块」：动词 × 对象 × 细节 组合，避免整段复读 */
function buildAction(v, r, used) {
  for (let i = 0; i < 80; i++) {
    const verb = pick(ACT_VERBS, r);
    const obj = pick(ACT_OBJECTS, r);
    const detail = pick(ACT_DETAILS, r);
    const text = `${v.who}${verb}，看着${obj}。${detail}`;
    const key = `a:${verb}|${obj}`;
    if (!used.has(text) && !used.has(key) && !used.has(`d:${detail}`)) {
      used.add(text); used.add(key); used.add(`d:${detail}`); return text;
    }
  }
  return `${v.who}把灯换到左手，右手在衣襟上擦了擦，指腹上留下一道黑印。他看了一眼，没有擦掉。`;
}

function buildDialogue(v, r, used) {
  for (let i = 0; i < 30; i++) {
    const text = pick(DIALOGUE_SETS, r)(v).join('\n');
    if (!used.has(text)) { used.add(text); return text; }
  }
  return null;
}

function buildUnique(pool, v, r, used) {
  for (let i = 0; i < 40; i++) {
    const text = pick(pool, r)(v);
    if (!used.has(text)) { used.add(text); return text; }
  }
  return null;
}

/**
 * 生成本章初稿：结构按大纲走，但**故意留下可被审稿抓到的问题**——
 * 位阶写错、违反火禁且无代价、AI 腔堆叠、段末命定感旁白。
 * 「审核 → 修正 → 去AI味」因此有真实效果可看（而不是演戏）。
 */
export function mockChapterText(project, chapterNo) {
  const card = flatChapters(project.outline).find((c) => c.no === chapterNo)
    || flatChapters(project.outline)[0];
  const cast = castFor(project, card);
  const r = makeRng(hash(`chapter-${chapterNo}`));
  const v = sceneVars(card, project, cast, r);
  const used = new Set();
  const paras = [];
  const push = (t) => { if (!t) return; if (paras.includes(t)) return; used.add(t); paras.push(t); };
  // 按字数补足：把未用过的块插到钩子之前，绝不重复整段
  const padTo = (target) => {
    let guard = 0;
    let misses = 0;
    while (countWords(paras.join('\n\n')) < target && guard++ < 160) {
      const builders = [
        () => buildAction(v, r, used),
        () => buildDialogue(v, r, used),
        () => buildUnique(INNER, v, r, used),
        () => buildUnique(SENSORY, v, r, used),
      ];
      const start = Math.floor(r() * builders.length);
      let t = null;
      for (let i = 0; i < builders.length && !t; i++) t = builders[(start + i) % builders.length]();
      if (!t) { misses++; if (misses > 3) break; continue; }
      misses = 0;
      paras.splice(Math.max(paras.length - 2, 0), 0, t);
    }
  };

  push(buildUnique(OPENERS, v, r, used));
  push(buildAction(v, r, used));
  push(buildDialogue(v, r, used));
  push(buildUnique(INNER, v, r, used));
  push(buildAction(v, r, used));
  push(buildUnique(SENSORY, v, r, used));

  // 位阶写错（设定冲突）：名字紧邻位阶，方便事实核对命中
  if (chapterNo % 3 === 1) {
    push(`差役看了看${v.who}，把伞往旁边偏了偏。在这条巷子里，${v.who}是三品灯官，一句话能调走半条街的灯。${v.who}愣住，指节在灯柄上收紧——他是九品，册子上写得清清楚楚。他没有纠正这个说法，只是点了点头，快步走进雨里。`);
  }

  push(buildDialogue(v, r, used));
  push(buildUnique(AI_FILLERS, v, r, used));
  // 本章转折（必须来自大纲卡片，保证情节真的往前走）
  push(`${v.who}把灯举高，光落在眼前那一片上。${v.turn}他站在原地，把这件事在心里翻来覆去地想，越想越觉得后颈发凉。`);
  push(buildUnique(TURNS, v, r, used));
  push(buildUnique(INNER, v, r, used));
  push(buildAction(v, r, used));

  // 违反火禁且没有代价（规则越界）：第 1 章必现，之后每 4 章一次
  if (chapterNo === 1 || chapterNo % 4 === 1) {
    push(`他知道规矩。灯不能在雨中点燃，点火的人当夜必死，这是巡夜司的第一条火禁。${v.who}还是把灯往前伸出去，雨点落进灯罩，火苗抖了两抖，燃了起来。他站着没动，等着那个当夜的死。`);
  }

  push(buildDialogue(v, r, used));
  push(buildUnique(SENSORY, v, r, used));
  push(buildAction(v, r, used));
  push(buildUnique(AI_FILLERS, v, r, used));
  push(buildUnique(INNER, v, r, used));

  // 命定感旁白（编辑审会判 AI 味）——放在章末钩子之前，但不贴着它
  push(`从这一刻起，${v.who}知道自己回不去了。他站在灯下，看着自己的影子被拉得很长很长，心里只剩一个念头：还来得及。`);

  // 本章结果
  push(`${v.who}把今晚的事在心里过了一遍。${v.result}他伸手摸了摸灯罩，还烫。${v.other}站在门口没有进来，只说了一句：「${String(v.obstacle).slice(0, 20)}……这道理，你比我清楚。」`);

  // 伏笔义务：本章应布置 / 回收的伏笔，用「记账」这个人物习惯落地
  const ledger = project.foreshadow?.ledger || [];
  const duties = [
    ...ledger.filter((f) => f.setupChapter === chapterNo).map((f) => f.name),
    ...ledger.filter((f) => f.payoffChapter === chapterNo).map((f) => f.name),
  ].filter((n, i, arr) => arr.indexOf(n) === i);
  if (duties.length) {
    push(`收灯前，${v.who}照例在巡夜册上记账。今日写下的条目是：${duties.join('、')}。写得下的都写了，写不下的，他留了一道空。`);
  }

  push(buildDialogue(v, r, used));
  push(buildUnique(INNER, v, r, used));

  // 章末钩子（前面不再垫命定旁白，保证钩子独立成立）
  push(card.hook || pick(CLOSERS, r));

  // 补足字数（目标 2400 左右，保证 ≥2000 的字数闸门）
  padTo(2420);

  return paras.join('\n\n');
}

/** mock 修订：真实处理审稿发现的问题，而不是假装改过 */
export function mockRevise(project, text, issues = [], chapterNo = 1) {
  let out = text;
  const applied = [];
  const card = flatChapters(project.outline).find((c) => c.no === chapterNo)
    || flatChapters(project.outline)[0];
  const cast = castFor(project, card);
  const r = makeRng(hash(`revise-${chapterNo}`));
  const v = sceneVars(card, project, cast, r);
  const used = new Set(splitParagraphs(out));

  for (const it of issues) {
    // 1) 位阶写错：整段重写，不做「数字全局替换」这种会把情节改坏的操作
    if (it.type === '设定冲突') {
      const parsed = String(it.rule || '').match(/^(.+?)的位阶是「(.+)」$/);
      const who = parsed ? parsed[1] : v.who;
      const expect = parsed ? parsed[2] : '';
      const wrong = (String(it.quote || '').match(/([一二三四五六七八九十\d]{1,3})品/) || [])[1];
      if (!wrong || !expect) continue;
      const wrongRe = new RegExp(`${wrong}品`);
      const paras = splitParagraphs(out);
      const idx = paras.findIndex((p) => wrongRe.test(p) && p.includes(who));
      if (idx >= 0) {
        paras[idx] = `差役看了看${who}，把伞往旁边偏了偏。按册子，${who}是${expect}，管着${v.place}的十二盏灯。他没有接那句客气话，只是点了点头，快步走进雨里。`;
        out = paras.join('\n\n');
        applied.push(`重写位阶写错的段落：${who}是「${expect}」，不是「${wrong}品」`);
      }
    }

    // 2) 规则越界：补上可见代价，而不是删掉冲突
    if (it.type === '规则越界') {
      const paras = splitParagraphs(out);
      const idx = paras.findIndex((p) => p.includes('灯不能在雨中点燃') || (it.quote && p.includes(it.quote.slice(0, 18))));
      if (idx >= 0) {
        paras[idx] = `他知道规矩。灯不能在雨中点燃，点火的人当夜必死。${v.who}把灯收回檐下，用袖子护住灯罩，等雨小一点。等到第三更，他还是没忍住，把灯点着了——第二天，他的右手起了七个水泡，指头弯不过来。火禁没要他的命，先要了他半只手。`;
        out = paras.join('\n\n');
        applied.push('改写违规桥段：补上可见代价（右手烫伤），不再无成本越界');
      }
    }
  }

  // 3) 章末钩子补强（已经存在同一钩子时不重复追加）
  const hs = hookScore(out);
  const lastPara = splitParagraphs(out).slice(-1)[0] || '';
  const hookAlreadyThere = card.hook && (lastPara.includes(card.hook.slice(0, 10)) || out.slice(-200).includes(card.hook.slice(0, 10)));
  if (hs.score < 6 && !hookAlreadyThere) {
    out = out.trim() + '\n\n' + (card.hook || '门外传来第二声敲门。');
    applied.push(`重写章末钩子（${hs.score} → 目标 ≥6）`);
  }

  // 4) 字数补足：补具体场景与对话，不补解释
  let guard = 0;
  while (countWords(out) < 2220 && guard++ < 40) {
    const add = [
      buildAction(v, r, used),
      buildDialogue(v, r, used),
      buildUnique(INNER, v, r, used),
    ].filter(Boolean);
    if (!add.length) break;
    const paras = splitParagraphs(out);
    paras.splice(Math.max(paras.length - 1, 0), 0, add.join('\n\n'));
    out = paras.join('\n\n');
  }

  return { text: out, applied };
}

/** mock 摘要：从正文里提取，而不是瞎编 */
export function mockSummarize(project, chapterNo, text) {
  const card = flatChapters(project.outline).find((c) => c.no === chapterNo)
    || flatChapters(project.outline)[0];
  const cast = castFor(project, card);
  const names = (project.characters || []).filter((c) => text.includes(c.name)).map((c) => c.name);
  const first = splitParagraphs(text)[0] || '';
  const last = splitParagraphs(text).filter((p) => p.length > 8).slice(-1)[0] || '';
  return {
    summary: `${card.goal.replace(/。$/, '')}——${card.obstacle.replace(/。$/, '')}。${card.turn}${card.result}（本章出场：${(names.length ? names : [cast.lead]).join('、')}）`,
    events: [
      `${cast.lead}在${card.scenes?.[0] || '影巷'}巡灯`,
      card.goal,
      card.turn,
      card.result,
    ],
    facts: [
      { who: cast.lead, fact: `第 ${chapterNo} 章后：${card.result}` },
    ],
    newTerms: [],
    foreshadowStatus: (card.foreshadow?.setup || []).map((name) => ({ name, action: 'planted', evidence: `本章出现「${name}」相关描写` })),
    openThreads: [card.hook],
    nextChapterSetup: `下一章从「${card.hook}」直接接续，不要再复述本章。`,
    excerpt: { first: first.slice(0, 60), last: last.slice(0, 60) },
  };
}

export function mockReviewPasses(project, chapter, measured) {
  const { issues: factIssues = [], words, minWords, aiScore, maxAi, hook, hookScoreValue, foreshadow } = measured;
  const logicIssues = [...factIssues];
  if (words < minWords * 0.6) {
    logicIssues.push({
      severity: 'high', type: '因果断裂',
      quote: splitParagraphs(chapter.current)[0]?.slice(0, 40) || '',
      why: '本章篇幅过短，转折缺少铺垫，读者会感到突兀。',
      fix: '在转折前补一场铺垫戏（具体场景，不要回忆）。',
    });
  }
  const logicScore = Math.max(35, 100 - logicIssues.length * 18);

  const paras = splitParagraphs(chapter.current);
  const dropPoints = [];
  paras.forEach((p, i) => {
    const a = aiFlavor(p);
    if (a.score > 5 && dropPoints.length < 3) {
      dropPoints.push({ paragraph: i + 1, quote: p.slice(0, 20), why: '这一段是形容词堆出来的，没有新信息，读者会划过去。', fix: '删掉一半修饰，换成具体动作或对话。' });
    }
  });
  const readerScore = Math.max(30, Math.min(98, Math.round(52 + hookScoreValue * 4.2 - dropPoints.length * 6 + (measured.dialogueRatio > 0.12 ? 6 : -6))));

  const gates = {
    wordCount: { ok: words >= minWords, value: words, require: `≥${minWords}` },
    aiFlavor: { ok: aiScore <= maxAi, value: aiScore, require: `≤${maxAi}` },
    styleConsistency: { ok: measured.sentenceLenStd >= 6, value: Number((10 - Math.max(0, 7 - measured.sentenceLenStd)).toFixed(1)), note: measured.sentenceLenStd < 6 ? '句长过于均匀，读起来像机器在匀速朗读。' : '长短句有起伏，与基准一致。' },
    hook: { ok: hookScoreValue >= 6, value: hookScoreValue, require: '≥6' },
    foreshadow: { ok: foreshadow.ok, value: foreshadow.value, missed: foreshadow.missed },
  };
  const editorIssues = [];
  if (!gates.wordCount.ok) editorIssues.push({ severity: 'high', type: '注水', quote: '', why: `字数 ${words}，低于 ${minWords} 的硬要求。`, fix: '补一场具体场景（有人做事、有人说话），不要补解释。' });
  if (!gates.aiFlavor.ok) editorIssues.push({ severity: 'high', type: 'AI味', quote: measured.topCliches.join('、'), why: `AI 味评分 ${aiScore}，超过阈值 ${maxAi}；高频词：${measured.topCliches.slice(0, 4).join('、')}。`, fix: '执行去AI味环节，替换套话、打散句式、删掉命定感旁白。' });
  if (!gates.hook.ok) editorIssues.push({ severity: 'medium', type: '钩子弱', quote: paras.slice(-1)[0]?.slice(0, 30) || '', why: `章末钩子强度 ${hookScoreValue}，低于 6。`, fix: '把最后一句改成具体的信息缺口或威胁，不要日常收束。' });
  if (!gates.foreshadow.ok) editorIssues.push({ severity: 'medium', type: '伏笔缺失', quote: '', why: `应布置/回收的伏笔未完成：${(gates.foreshadow.missed || []).join('、')}`, fix: '在本章中段用一个具体细节补上，不要直接点名解释。' });
  if (!gates.styleConsistency.ok) editorIssues.push({ severity: 'medium', type: '句式单调', quote: measured.shortest || '', why: '句子长度集中在同一区间，缺少短句的节奏断点。', fix: '每 3-4 句插一个 3-8 字的短句。' });
  const editorScore = Math.max(35, 100 - editorIssues.reduce((s, i) => s + (i.severity === 'high' ? 16 : 8), 0));

  return {
    logic: {
      name: '逻辑审',
      score: logicScore,
      issues: logicIssues,
      verdict: logicIssues.some((i) => i.severity === 'high') ? 'revise' : 'pass',
      note: logicIssues.length ? `发现 ${logicIssues.length} 处硬伤，其中 ${logicIssues.filter((i) => i.severity === 'high').length} 处必须改。` : '未发现设定冲突与因果断裂。',
    },
    reader: {
      name: '读者审',
      score: readerScore,
      issues: dropPoints.map((d) => ({ severity: 'medium', type: '弃书点', quote: d.quote, why: d.why, fix: d.fix })),
      dropPoints,
      emotionCurve: [
        { at: '开头', emotion: '压抑', intensity: 5 },
        { at: '前段', emotion: '好奇', intensity: 6 },
        { at: '中段', emotion: '紧张', intensity: 7 },
        { at: '后段', emotion: '憋屈', intensity: 6 },
        { at: '结尾', emotion: '好奇', intensity: Math.round(hookScoreValue) },
      ],
      payoff: '本章的回报是「信息」：读者拿到的不是爽点，而是一个能反推前文的细节。',
      hookComment: hookScoreValue >= 6 ? '章末钩子有效：给出了具体的下一步问题。' : '章末太像小结，需要改成具体威胁或信息缺口。',
      verdict: readerScore >= 60 && hookScoreValue >= 6 ? 'pass' : 'revise',
    },
    editor: {
      name: '编辑审',
      score: editorScore,
      issues: editorIssues,
      gates,
      verdict: Object.values(gates).every((g) => g.ok) && editorScore >= 70 ? 'pass' : 'revise',
    },
  };
}

export function mockCompress(project, previous, newSummaries, limit = 1200) {
  const lines = [];
  const prev = (previous || '').trim();
  if (prev) lines.push('〔既有摘要〕' + prev.replace(/\s+/g, ' '));
  for (const s of newSummaries) lines.push(s.replace(/\s+/g, ' '));
  let out = lines.join('\n');
  if (out.length > limit) out = out.slice(0, limit - 1) + '…';
  return out;
}
