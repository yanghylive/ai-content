#!/usr/bin/env ruby
# frozen_string_literal: true

require "pathname"
require "yaml"

require_relative "lib/validation"

repo_root = Pathname.new(__dir__).join("..").expand_path
registry_path = repo_root.join("capabilities", "registry.yaml")
abort "missing capability registry: #{registry_path}" unless registry_path.file?

errors = []
registry = YAML.load_file(registry_path.to_s)
unless registry.is_a?(Hash) && registry["schema_version"] == "1.0" && registry["capabilities"].is_a?(Array)
  errors << "capabilities/registry.yaml must contain schema_version 1.0 and a capabilities array"
end

registered_ids = []
Array(registry.is_a?(Hash) && registry["capabilities"]).each_with_index do |entry, index|
  unless entry.is_a?(Hash) && entry["id"].is_a?(String) && entry["version"].is_a?(String) && entry["manifest"].is_a?(String)
    errors << "capabilities/registry.yaml capabilities[#{index}] must declare id, version, and manifest"
    next
  end

  registered_ids << entry["id"]
  manifest_path = repo_root.join("capabilities", entry["manifest"]).cleanpath
  capability_root = repo_root.join("capabilities").expand_path
  unless manifest_path.to_s.start_with?(capability_root.to_s + File::SEPARATOR) && manifest_path.file?
    errors << "capability registry entry #{entry['id']} has invalid manifest path: #{entry['manifest'].inspect}"
    next
  end

  begin
    capability = YAML.load_file(manifest_path.to_s)
    errors.concat(AgentWakerValidation.validate_shared_capability(capability, capability_dir: manifest_path.dirname))
    if capability.is_a?(Hash)
      errors << "registry id mismatch for #{entry['id']}" unless capability["id"] == entry["id"]
      errors << "registry version mismatch for #{entry['id']}" unless capability["version"] == entry["version"]
    end
  rescue StandardError => e
    errors << "invalid capability manifest #{manifest_path}: #{e.message}"
  end
end

duplicates = registered_ids.group_by(&:itself).select { |_, values| values.length > 1 }.keys
errors << "capability registry has duplicate ids: #{duplicates.join(', ')}" unless duplicates.empty?

manifest_ids = Dir.glob(repo_root.join("capabilities", "*", "CAPABILITY.yaml").to_s)
                  .map { |path| Pathname.new(path).dirname.basename.to_s }
                  .sort
errors << "capability registry does not match capability directories" unless registered_ids.sort == manifest_ids

if errors.empty?
  puts "PASS: #{registered_ids.length} shared capabilities passed manifest, contract, path, and registry checks"
else
  warn "FAIL: shared capabilities"
  errors.uniq.each { |error| warn "- #{error}" }
  exit 1
end
