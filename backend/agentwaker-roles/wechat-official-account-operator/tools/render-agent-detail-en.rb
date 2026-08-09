#!/usr/bin/env ruby
# frozen_string_literal: true

FILES = %w[
  PROFILE.yaml
  IDENTITY.md
  PERSONA.md
  WORK_STYLES.md
  BIBLE.md
  TOOLS.md
  CORE_CAPABILITIES.md
  DELIVERY_COMMITMENTS.md
  USER.md
  MEMORY.md
].freeze

def render_collection(role_dir)
  soul_dir = File.join(role_dir, "agent-soul")
  missing = FILES.reject { |name| File.file?(File.join(soul_dir, name)) }
  abort "Missing authoritative source files: #{missing.join(', ')}" unless missing.empty?

  output = +<<~HEADER
    # Agent Soul / English Source Files

    > This file is generated from the 10 authoritative files under `agent-soul/`. Edit the source files, then regenerate this collection.

  HEADER

  FILES.each do |name|
    language = name.end_with?(".yaml") ? "yaml" : "markdown"
    body = File.read(File.join(soul_dir, name), encoding: "UTF-8").rstrip
    # Four backticks keep embedded triple-backtick examples in authoritative
    # Markdown sources from closing the aggregate fence early.
    output << "## #{name}\n\n````#{language}\n#{body}\n````\n\n"
  end

  output.rstrip + "\n"
end

check = ARGV.delete("--check")
role_arg = ARGV.shift
abort "Usage: render-agent-detail-en.rb <role-directory> [--check]" unless role_arg && ARGV.empty?

role_dir = File.expand_path(role_arg)
abort "Role directory does not exist: #{role_dir}" unless File.directory?(role_dir)

target = File.join(role_dir, "agent-detail.en.md")
expected = render_collection(role_dir)

if check
  abort "STALE: #{target}" unless File.file?(target) && File.read(target, encoding: "UTF-8") == expected

  puts "PASS: #{target} matches the 10 authoritative source files"
else
  File.write(target, expected, mode: "w", encoding: "UTF-8")
  puts "WROTE: #{target}"
end
