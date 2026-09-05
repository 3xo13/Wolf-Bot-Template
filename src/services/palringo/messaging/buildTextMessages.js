import { nanoid } from 'nanoid';
import { PalringoClientError } from '../errors.js';

const URL_PATTERN = /(?:https?:\/\/[^\s]+|www\.[^\s]+)/giu;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/gu;
const GROUP_LINK_PATTERN = /\[([^\r\n]+?)\]/gu;

function normalizeFormatting (formatting = {}) {
  return {
    alert: formatting.alert === true,
    failed: formatting.failed === true,
    includeEmbeds: formatting.includeEmbeds === true,
    me: formatting.me === true,
    renderAds: formatting.renderAds !== false,
    renderLinks: formatting.renderLinks !== false,
    success: formatting.success === true
  };
}

function applyPrefixes (content, formatting) {
  let result = String(content).trim();
  if (formatting.success) { result = `(Y) ${result}`; }
  if (formatting.failed) { result = `(N) ${result}`; }
  if (formatting.alert) { result = `/alert ${result}`; }
  if (formatting.me) { result = `/me ${result}`; }
  return result;
}

function expandMarkdownLinks (content) {
  const links = [];
  let visible = '';
  let cursor = 0;

  for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
    visible += content.slice(cursor, match.index);
    const start = visible.length;
    visible += match[1];
    links.push({ start, end: visible.length, url: match[2] });
    cursor = match.index + match[0].length;
  }
  visible += content.slice(cursor);
  return { content: visible, links };
}

function rangesOverlap (left, right) {
  return left.start < right.end && right.start < left.end;
}

function findPlainLinks (content, existingLinks) {
  return [...content.matchAll(URL_PATTERN)]
    .map(match => ({
      start: match.index,
      end: match.index + match[0].replace(/[.,!?;:]+$/u, '').length,
      url: match[0].replace(/[.,!?;:]+$/u, '')
    }))
    .filter(link => !existingLinks.some(existing => rangesOverlap(link, existing)));
}

async function findGroupLinks (content, resolveChannelByName) {
  if (!resolveChannelByName) { return []; }
  const links = [];
  for (const match of content.matchAll(GROUP_LINK_PATTERN)) {
    try {
      const channel = await resolveChannelByName(match[1].trim());
      if (channel?.id) {
        links.push({ start: match.index, end: match.index + match[0].length, groupId: channel.id });
      }
    } catch {}
  }
  return links;
}

function chooseChunkEnd (content, start, maxLength, annotations) {
  if (content.length - start <= maxLength) { return content.length; }
  let end = start + maxLength;
  const crossing = annotations.find(annotation => annotation.start < end && annotation.end > end);
  if (crossing && crossing.start > start) { end = crossing.start; }
  const whitespace = content.lastIndexOf(' ', end);
  if (whitespace > start) { end = whitespace; }
  return end <= start ? Math.min(content.length, start + maxLength) : end;
}

function buildChunks (content, maxLength, annotations) {
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    while (content[start] === ' ') { start++; }
    if (start >= content.length) { break; }
    const end = chooseChunkEnd(content, start, maxLength, annotations);
    chunks.push({ content: content.slice(start, end).trimEnd(), start, end });
    start = end;
  }
  return chunks;
}

export async function buildTextMessages ({
  recipient,
  content,
  isGroup = false,
  formatting: formattingInput,
  maxLength = 1000,
  resolveChannelByName,
  flightIdFactory = () => nanoid(32)
}) {
  const target = Number(recipient);
  if (!Number.isInteger(target) || target <= 0) {
    throw new PalringoClientError('recipient must be a positive integer', { recipient });
  }
  if (content === undefined || content === null) {
    throw new PalringoClientError('content is required');
  }

  const formatting = normalizeFormatting(formattingInput);
  if (formatting.me && formatting.alert) {
    throw new PalringoClientError('A message cannot use /me and /alert together');
  }
  if (formatting.success && formatting.failed) {
    throw new PalringoClientError('A message cannot be both successful and failed');
  }

  const expanded = expandMarkdownLinks(applyPrefixes(content, formatting));
  if (!expanded.content) { throw new PalringoClientError('content cannot be empty'); }
  const plainLinks = formatting.renderLinks ? findPlainLinks(expanded.content, expanded.links) : [];
  const links = formatting.renderLinks ? [...expanded.links, ...plainLinks] : [];
  const groupLinks = formatting.renderAds
    ? await findGroupLinks(expanded.content, resolveChannelByName)
    : [];
  const annotations = [...links, ...groupLinks].sort((left, right) => left.start - right.start);
  const chunks = buildChunks(expanded.content, maxLength, annotations);

  let embedAttached = false;
  return chunks.map(chunk => {
    const chunkLinks = links
      .filter(link => link.start >= chunk.start && link.end <= chunk.end)
      .map(link => ({ start: link.start - chunk.start, end: link.end - chunk.start, url: link.url }));
    const chunkGroups = groupLinks
      .filter(link => link.start >= chunk.start && link.end <= chunk.end)
      .map(link => ({ start: link.start - chunk.start, end: link.end - chunk.start, groupId: link.groupId }));
    const metadataFormatting = {};
    if (chunkLinks.length) { metadataFormatting.links = chunkLinks; }
    if (chunkGroups.length) { metadataFormatting.groupLinks = chunkGroups; }
    const embeds = formatting.includeEmbeds && !embedAttached && chunkGroups.length
      ? [{ type: 'groupPreview', groupId: chunkGroups[0].groupId }]
      : undefined;
    embedAttached = embedAttached || !!embeds;

    return {
      recipient: target,
      isGroup,
      mimeType: 'text/plain',
      data: Buffer.from(chunk.content, 'utf8'),
      flightId: flightIdFactory(),
      metadata: Object.keys(metadataFormatting).length ? { formatting: metadataFormatting } : undefined,
      embeds
    };
  });
}

export default buildTextMessages;
