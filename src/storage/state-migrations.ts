import {
  DEFAULT_SERVICE_REGION,
  DEFAULT_VOICE_MODE,
  normalizeServiceRegion,
  normalizeVoiceMode,
} from '../speech/profiles';
import {
  getTextProviderProfile,
  legacyTextProviderId,
  normalizeTextProviderId,
} from '../llm/profiles';
import { normalizeDailyRecommendationDeck } from '../core/recommendations';

export const CURRENT_STATE_FORMAT_VERSION = 6;

type JsonRecord = Record<string, unknown>;

const LEGACY_DEMO_PROFILE_SIGNATURE = '170:1nt9r0y:96maw6';
const LEGACY_DEMO_ITEM_SIGNATURES = new Set([
  '136:6wj8ha:1n1yj2o',
  '113:1dix0ks:1itr3c8',
  '45:sragcj:16t2z7',
  '159:sn6y0l:1tev90h',
  '114:11i4pns:1grnzmc',
  '101:1d8jwai:1fmbpne',
]);
const LEGACY_DEMO_COMPRESSION_SIGNATURE = '393:6ig11m:mxmtwg';

const EMPTY_PROFILE = {
  name: '',
  role: '',
  org: '',
  goal: '',
  domains: [],
  counterparts: [],
  scenarios: [],
  upcoming: '',
  variety: 'international',
  englishLevel: null,
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function signature(value: string): string {
  let first = 0x811c9dc5;
  let second = 5381;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second, 33) ^ code;
  }
  return `${value.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

function profileSignature(profile: unknown): string {
  if (!isRecord(profile)) return '';
  if (String(profile.goal ?? '').trim()) return '';
  return signature(JSON.stringify([
    profile.name ?? '',
    profile.role ?? '',
    profile.org ?? '',
    profile.domains ?? [],
    profile.counterparts ?? [],
    profile.scenarios ?? [],
    profile.upcoming ?? '',
    profile.variety ?? 'international',
  ]));
}

function itemSignature(item: unknown): string {
  if (!isRecord(item) || !isRecord(item.source)) return '';
  return signature([
    item.skeleton ?? '',
    item.source.kind ?? '',
    item.source.raw ?? '',
  ].join('\u001f'));
}

function compressionSignature(compression: unknown): string {
  if (!isRecord(compression)) return '';
  return signature([
    compression.long ?? '',
    compression.short ?? '',
    compression.longWords ?? '',
    compression.shortWords ?? '',
  ].join('\u001f'));
}

function migrateSettings(value: unknown): JsonRecord {
  const settings: JsonRecord = isRecord(value) ? { ...value } : {};
  const serviceRegion = normalizeServiceRegion(settings.serviceRegion);
  const hasLegacyProvider = Boolean(
    String(settings.baseUrl || '').trim()
    || String(settings.model || '').trim(),
  );
  const providerMode = settings.providerMode === 'custom'
    || settings.providerMode === 'profile'
    ? settings.providerMode
    : (hasLegacyProvider ? 'custom' : 'profile');
  const textProviderId = settings.textProviderId
    ? normalizeTextProviderId(settings.textProviderId, serviceRegion)
    : legacyTextProviderId(serviceRegion);
  const textProvider = getTextProviderProfile(textProviderId, serviceRegion);

  return {
    ...settings,
    providerMode,
    textProviderId,
    serviceRegion: settings.serviceRegion
      ? serviceRegion
      : DEFAULT_SERVICE_REGION,
    voiceMode: normalizeVoiceMode(settings.voiceMode || DEFAULT_VOICE_MODE),
    baseUrl: providerMode === 'profile'
      ? ''
      : String(settings.baseUrl || ''),
    model: providerMode === 'profile'
      ? ''
      : String(settings.model || ''),
    protocol: providerMode === 'profile'
      ? textProvider.protocol
      : String(settings.protocol || 'chat_completions'),
  };
}

export function migratePersistedState(input: unknown): unknown {
  if (!isRecord(input)) return input;

  const formatVersion = Number(input.formatVersion ?? 0);
  if (formatVersion >= CURRENT_STATE_FORMAT_VERSION) return input;

  const oldItems = Array.isArray(input.items) ? input.items : [];
  const removedItemIds = new Set<string>();
  const items = oldItems.filter((item) => {
    const remove = LEGACY_DEMO_ITEM_SIGNATURES.has(itemSignature(item));
    if (remove && isRecord(item) && typeof item.id === 'string') {
      removedItemIds.add(item.id);
    }
    return !remove;
  });

  const inbox = (Array.isArray(input.inbox) ? input.inbox : []).filter(
    (entry) => !isRecord(entry) || entry.source !== 'demo',
  );
  const compressions = (Array.isArray(input.compressions) ? input.compressions : []).filter(
    (entry) => compressionSignature(entry) !== LEGACY_DEMO_COMPRESSION_SIGNATURE,
  );
  const notificationReplies = (
    Array.isArray(input.notificationReplies) ? input.notificationReplies : []
  ).filter(
    (reply) => !isRecord(reply)
      || typeof reply.itemId !== 'string'
      || !removedItemIds.has(reply.itemId),
  );

  const migrated: JsonRecord = {
    ...input,
    formatVersion: CURRENT_STATE_FORMAT_VERSION,
    profile: profileSignature(input.profile) === LEGACY_DEMO_PROFILE_SIGNATURE
      ? { ...EMPTY_PROFILE }
      : input.profile,
    items,
    inbox,
    compressions,
    dailyRecommendations: normalizeDailyRecommendationDeck(
      input.dailyRecommendations,
    ),
    notificationReplies,
    settings: migrateSettings(input.settings),
  };
  delete migrated.seeded;
  return migrated;
}
