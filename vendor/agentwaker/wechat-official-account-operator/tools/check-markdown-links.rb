#!/usr/bin/env ruby
# frozen_string_literal: true

require "pathname"
require "uri"

root = Pathname.new(__dir__).join("..").expand_path
errors = []

Dir.glob(root.join("**", "*.md").to_s, File::FNM_DOTMATCH).sort.each do |path_value|
  path = Pathname.new(path_value)
  content = path.read(encoding: "UTF-8")
  content.scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.each do |target|
    next if target.match?(/\A(?:https?:\/\/|mailto:|#)/)

    relative = target.split("#", 2).first.to_s
    next if relative.empty?

    decoded = URI::DEFAULT_PARSER.unescape(relative)
    resolved = path.dirname.join(decoded).cleanpath
    errors << "#{path.relative_path_from(root)}: broken link #{target.inspect}" unless resolved.exist?
  end
end

if errors.empty?
  puts "PASS: local Markdown links resolve"
else
  warn "FAIL: local Markdown links"
  errors.each { |error| warn "- #{error}" }
  exit 1
end
