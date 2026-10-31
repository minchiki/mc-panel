export type PropField =
  | { key: string; label: string; hint?: string; type: "text"; placeholder?: string }
  | { key: string; label: string; hint?: string; type: "number"; min?: number; max?: number }
  | { key: string; label: string; hint?: string; type: "bool" }
  | { key: string; label: string; hint?: string; type: "select"; options: { value: string; label: string }[] };

export interface PropGroup {
  title: string;
  description?: string;
  fields: PropField[];
}

/** The keys players actually change, with human labels; everything else lands in "Другие параметры". */
export const PROPERTY_GROUPS: PropGroup[] = [
  {
    title: "Игра",
    fields: [
      {
        key: "gamemode",
        label: "Режим игры",
        type: "select",
        options: [
          { value: "survival", label: "Выживание" },
          { value: "creative", label: "Творческий" },
          { value: "adventure", label: "Приключение" },
          { value: "spectator", label: "Наблюдатель" },
        ],
      },
      {
        key: "difficulty",
        label: "Сложность",
        type: "select",
        options: [
          { value: "peaceful", label: "Мирная" },
          { value: "easy", label: "Лёгкая" },
          { value: "normal", label: "Нормальная" },
          { value: "hard", label: "Сложная" },
        ],
      },
      { key: "max-players", label: "Максимум игроков", type: "number", min: 1, max: 1000 },
      { key: "pvp", label: "PvP", hint: "Игроки могут наносить урон друг другу", type: "bool" },
      { key: "hardcore", label: "Хардкор", hint: "После смерти игрок становится наблюдателем", type: "bool" },
      { key: "force-gamemode", label: "Принудительный режим", hint: "При входе всем ставится режим сервера", type: "bool" },
      { key: "allow-flight", label: "Разрешить полёт", hint: "Нужно для модов и плагинов с полётом, иначе игроков будет кикать", type: "bool" },
      { key: "spawn-protection", label: "Защита спавна (блоков)", hint: "0 — выключить", type: "number", min: 0, max: 1000 },
    ],
  },
  {
    title: "Доступ",
    fields: [
      { key: "white-list", label: "Вайтлист", hint: "Пускать только игроков из списка", type: "bool" },
      { key: "enforce-whitelist", label: "Кикать не из вайтлиста", hint: "При включении вайтлиста сразу выгнать остальных", type: "bool" },
      {
        key: "online-mode",
        label: "Проверка лицензии (online-mode)",
        hint: "Выключите только для пиратских клиентов: тогда любой сможет зайти под любым ником",
        type: "bool",
      },
      { key: "player-idle-timeout", label: "Кик за бездействие (мин)", hint: "0 — не кикать", type: "number", min: 0, max: 1440 },
      { key: "enable-command-block", label: "Командные блоки", type: "bool" },
    ],
  },
  {
    title: "Мир",
    fields: [
      { key: "level-name", label: "Папка мира", hint: "Смена создаст новый мир, старый останется в файлах", type: "text" },
      { key: "level-seed", label: "Сид", hint: "Применяется только при создании нового мира", type: "text", placeholder: "случайный" },
      {
        key: "level-type",
        label: "Тип мира",
        type: "select",
        options: [
          { value: "minecraft:normal", label: "Обычный" },
          { value: "minecraft:flat", label: "Плоский" },
          { value: "minecraft:large_biomes", label: "Большие биомы" },
          { value: "minecraft:amplified", label: "Расширенный" },
        ],
      },
      { key: "allow-nether", label: "Незер", type: "bool" },
      { key: "generate-structures", label: "Генерировать постройки", type: "bool" },
      { key: "max-world-size", label: "Радиус мира (блоков)", type: "number", min: 1, max: 29999984 },
    ],
  },
  {
    title: "Производительность",
    description: "Меньше дистанция — меньше нагрузка на CPU и RAM",
    fields: [
      { key: "view-distance", label: "Дальность прорисовки (чанки)", type: "number", min: 3, max: 32 },
      { key: "simulation-distance", label: "Дальность симуляции (чанки)", type: "number", min: 3, max: 32 },
      { key: "network-compression-threshold", label: "Порог сжатия трафика", type: "number", min: -1, max: 65535 },
    ],
  },
];

export const KNOWN_KEYS = new Set(["motd", ...PROPERTY_GROUPS.flatMap((g) => g.fields.map((f) => f.key))]);
