#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "pathname"

SOUL_FILES = %w[
  PROFILE.yaml
  IDENTITY.md
  PERSONA.md
  WORK_STYLES.md
  BIBLE.md
  TOOLS.md
  CORE_CAPABILITIES.md
  DELIVERY_COMMITMENTS.md
].freeze

# USER.md and MEMORY.md are runtime-learning surfaces. They remain part of the
# generated English aggregate, but ordinary preference or learned-memory writes
# must not invalidate public identity displays that do not reproduce those
# entries. Identity, behavior, capability, skill, environment, and MCP changes
# still require an explicit display review.

DISPLAY_FILES = %w[
  agent-detail.zh.md
  agent-persona.html
].freeze

MARKER_LABEL = "AGENTWAKER_DISPLAY_SOURCE_SHA256"
MARKER_PATTERN = /<!--\s*#{MARKER_LABEL}:\s*([0-9a-f]{64}|\{\{source_digest\}\})\s*-->/

def usage!
  abort "Usage: sync-display-digest.rb <role-directory> [--check]"
end

role_arg = ARGV.shift
check = ARGV.delete("--check")
usage! unless role_arg && ARGV.empty?

role_dir = Pathname.new(File.expand_path(role_arg))
abort "Role directory does not exist: #{role_dir}" unless role_dir.directory?

source_paths = SOUL_FILES.map { |name| role_dir.join("agent-soul", name) }
source_paths.concat(
  Dir.glob(role_dir.join("*-skills", "**", "SKILL.md").to_s).sort.map { |path| Pathname.new(path) }
)
source_paths.concat(%w[env/.env.example mcp/mcp.json].map { |path| role_dir.join(path) })

missing_sources = source_paths.reject(&:file?)
unless missing_sources.empty?
  abort "Missing display source files:\n- #{missing_sources.join("\n- ")}"
end

digest = Digest::SHA256.new
source_paths.sort_by(&:to_s).each do |path|
  relative = path.relative_path_from(role_dir).to_s
  digest.update(relative)
  digest.update("\0")
  digest.update(path.binread)
  digest.update("\0")
end
expected = digest.hexdigest
marker = "<!-- #{MARKER_LABEL}: #{expected} -->"

errors = []
updated = []

DISPLAY_FILES.each do |relative|
  path = role_dir.join(relative)
  unless path.file?
    errors << "missing display file: #{path}"
    next
  end

  content = path.read(encoding: "UTF-8")
  match = content.match(MARKER_PATTERN)

  if check
    if match.nil?
      errors << "missing display source digest marker: #{path}"
    elsif match[1] != expected
      errors << "stale display source digest in #{path}: expected #{expected}, found #{match[1]}"
    end
    next
  end

  replacement = if match
                  content.sub(MARKER_PATTERN, marker)
                elsif relative.end_with?(".html") && content.match?(/\A<!doctype html>\s*\n/i)
                  content.sub(/\A(<!doctype html>\s*\n)/i, "\\1#{marker}\n")
                else
                  "#{marker}\n#{content}"
                end

  next if replacement == content

  path.write(replacement, encoding: "UTF-8")
  updated << path
end

unless errors.empty?
  warn "FAIL: #{role_dir.basename} display source digest"
  errors.each { |error| warn "- #{error}" }
  exit 1
end

if check
  puts "PASS: #{role_dir.basename} display files acknowledge source digest #{expected}"
elsif updated.empty?
  puts "UNCHANGED: #{role_dir.basename} display source digest #{expected}"
else
  puts "UPDATED: #{role_dir.basename} display source digest #{expected} (#{updated.length} files)"
end
