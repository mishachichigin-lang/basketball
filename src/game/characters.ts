export type StyleId = 'akashi' | 'aomine' | 'kuroko';
export type AllCharacterId = StyleId | 'kagami' | 'midorima';

export interface SkillDefinition {
  key: 'Q' | 'E' | 'Z';
  nameRu: string;
  nameEn: string;
  cooldown: number; // seconds (0 for Zone which uses meter)
  descriptionRu: string;
}

export interface CharacterStyle {
  id: AllCharacterId;
  playable: boolean;
  nameRu: string;
  nameEn: string;
  schoolRu: string;
  number: string;
  roleRu: string;
  primaryColor: string;
  secondaryColor: string;
  hairColor: string;
  skinColor: string;
  jerseyBg: string;
  jerseyTrim: string;
  eyeColor: string;
  zoneAuraColor: string;
  stats: {
    speed: number;       // base walk/run speed m/s
    threePoint: number;  // 0..1 base proficiency
    twoPoint: number;    // 0..1 base proficiency
    stealReach: number;  // meters
    passSpeed: number;   // m/s
  };
  skills: [SkillDefinition, SkillDefinition, SkillDefinition];
}

export const CHARACTER_STYLES: Record<AllCharacterId, CharacterStyle> = {
  akashi: {
    id: 'akashi',
    playable: true,
    nameRu: 'Акаши Сейджуро',
    nameEn: 'Akashi Seijuro',
    schoolRu: 'Ракузан',
    number: '4',
    roleRu: 'Император · Дриблинг и Перехват',
    primaryColor: '#E11D48',
    secondaryColor: '#F59E0B',
    hairColor: '#DC2626',
    skinColor: '#F6D5B8',
    jerseyBg: '#F8FAFC',
    jerseyTrim: '#991B1B',
    eyeColor: '#F59E0B',
    zoneAuraColor: '#F43F5E',
    stats: {
      speed: 8.6,
      threePoint: 0.78,
      twoPoint: 0.86,
      stealReach: 2.9,
      passSpeed: 22,
    },
    skills: [
      {
        key: 'Q',
        nameRu: 'Ankle Break',
        nameEn: 'Ankle Break',
        cooldown: 6.5,
        descriptionRu: 'Резкий кроссовер: сбивает ближайшего защитника на паркет на 2.2с',
      },
      {
        key: 'E',
        nameRu: 'Глаз Императора',
        nameEn: 'Emperor Eye',
        cooldown: 7.5,
        descriptionRu: 'Мгновенно выбивает мяч из рук соперника в радиусе взгляда',
      },
      {
        key: 'Z',
        nameRu: 'Зона Императора',
        nameEn: 'Emperor Zone',
        cooldown: 0,
        descriptionRu: '100% Зона: ало-золотые молнии, +35% скорость и точные броски',
      },
    ],
  },
  aomine: {
    id: 'aomine',
    playable: true,
    nameRu: 'Аомине Дайки',
    nameEn: 'Aomine Daiki',
    schoolRu: 'Тоо Академия',
    number: '5',
    roleRu: 'Ас · Бесформенный Бросок',
    primaryColor: '#2563EB',
    secondaryColor: '#38BDF8',
    hairColor: '#1E3A8A',
    skinColor: '#C68B59',
    jerseyBg: '#0F172A',
    jerseyTrim: '#3B82F6',
    eyeColor: '#38BDF8',
    zoneAuraColor: '#38BDF8',
    stats: {
      speed: 9.2,
      threePoint: 0.74,
      twoPoint: 0.9,
      stealReach: 2.4,
      passSpeed: 19,
    },
    skills: [
      {
        key: 'Q',
        nameRu: 'Рывок Миража',
        nameEn: 'Mirage Dash',
        cooldown: 5.5,
        descriptionRu: 'Сверхбыстрый уличный рывок вперёд, сбрасывающий опекуна',
      },
      {
        key: 'E',
        nameRu: 'Formless Shot',
        nameEn: 'Formless Shot',
        cooldown: 7.0,
        descriptionRu: 'Бесформенный бросок с отклонением: почти не блокируется защитой',
      },
      {
        key: 'Z',
        nameRu: 'Зона Аса',
        nameEn: 'Wild Zone',
        cooldown: 0,
        descriptionRu: '100% Зона: синие молнии, +45% скорость и экстремальная точность',
      },
    ],
  },
  kuroko: {
    id: 'kuroko',
    playable: true,
    nameRu: 'Куроко Тецуя',
    nameEn: 'Kuroko Tetsuya',
    schoolRu: 'Сейрин',
    number: '11',
    roleRu: 'Фантом · Невидимость и Пас',
    primaryColor: '#06B6D4',
    secondaryColor: '#E2E8F0',
    hairColor: '#67E8F9',
    skinColor: '#FBE4D2',
    jerseyBg: '#111827',
    jerseyTrim: '#DC2626',
    eyeColor: '#22D3EE',
    zoneAuraColor: '#22D3EE',
    stats: {
      speed: 8.4,
      threePoint: 0.65,
      twoPoint: 0.78,
      stealReach: 2.7,
      passSpeed: 30,
    },
    skills: [
      {
        key: 'Q',
        nameRu: 'Vanishing Drive',
        nameEn: 'Vanishing Drive',
        cooldown: 6.0,
        descriptionRu: 'Перенаправление внимания: фантомный проход сквозь опекуна',
      },
      {
        key: 'E',
        nameRu: 'Ignite / Phantom Shot',
        nameEn: 'Ignite Pass',
        cooldown: 5.5,
        descriptionRu: 'Сверхбыстрый пас напарнику или высокий Фантомный бросок в кольцо',
      },
      {
        key: 'Z',
        nameRu: 'Прямая Зона',
        nameEn: 'Direct Drive Zone',
        cooldown: 0,
        descriptionRu: '100% Зона: циановые потоки, ускорение команды и мгновенный откат',
      },
    ],
  },
  kagami: {
    id: 'kagami',
    playable: false,
    nameRu: 'Кагами Тайга',
    nameEn: 'Kagami Taiga',
    schoolRu: 'Сейрин',
    number: '10',
    roleRu: 'Форвард · Прыжок Метеора',
    primaryColor: '#EF4444',
    secondaryColor: '#1E293B',
    hairColor: '#991B1B',
    skinColor: '#F2C9A8',
    jerseyBg: '#111827',
    jerseyTrim: '#EF4444',
    eyeColor: '#EF4444',
    zoneAuraColor: '#EF4444',
    stats: {
      speed: 8.8,
      threePoint: 0.7,
      twoPoint: 0.87,
      stealReach: 2.5,
      passSpeed: 20,
    },
    skills: [
      { key: 'Q', nameRu: 'Прорыв', nameEn: 'Drive', cooldown: 6, descriptionRu: '' },
      { key: 'E', nameRu: 'Данк', nameEn: 'Meteor Jam', cooldown: 7, descriptionRu: '' },
      { key: 'Z', nameRu: 'Зона', nameEn: 'Zone', cooldown: 0, descriptionRu: '' },
    ],
  },
  midorima: {
    id: 'midorima',
    playable: false,
    nameRu: 'Мидорима Шинтаро',
    nameEn: 'Midorima Shintaro',
    schoolRu: 'Шутоку',
    number: '6',
    roleRu: 'Снайпер · Высокая дуга',
    primaryColor: '#10B981',
    secondaryColor: '#F97316',
    hairColor: '#15803D',
    skinColor: '#F7D7BE',
    jerseyBg: '#064E3B',
    jerseyTrim: '#F97316',
    eyeColor: '#10B981',
    zoneAuraColor: '#34D399',
    stats: {
      speed: 8.1,
      threePoint: 0.92,
      twoPoint: 0.82,
      stealReach: 2.2,
      passSpeed: 20,
    },
    skills: [
      { key: 'Q', nameRu: 'Степбэк', nameEn: 'Stepback', cooldown: 6, descriptionRu: '' },
      { key: 'E', nameRu: 'Трёхочковый', nameEn: 'High Arc', cooldown: 7, descriptionRu: '' },
      { key: 'Z', nameRu: 'Зона', nameEn: 'Zone', cooldown: 0, descriptionRu: '' },
    ],
  },
};

export const PLAYABLE_STYLES: CharacterStyle[] = [
  CHARACTER_STYLES.akashi,
  CHARACTER_STYLES.aomine,
  CHARACTER_STYLES.kuroko,
];
