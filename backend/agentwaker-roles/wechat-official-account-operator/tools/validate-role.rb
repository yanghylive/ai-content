#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "optparse"
require "pathname"
require "rbconfig"
require "yaml"

require_relative "lib/validation"

SOUL_FILES = %w[
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

RUNTIME_STORAGE_FIELDS = {
  "work_dir_env" => "AGENT_WORK_DIR",
  "memory_file_env" => "AGENT_MEMORY_FILE",
  "target_root_env" => "AGENT_TARGET_ROOT",
  "work_dir_layout" => "workdir-v1",
  "memory_read_on_start" => true,
  "memory_write_policy" => "curated",
  "completion_record" => "run.yaml"
}.freeze

RUNTIME_ENV_VARIABLES = %w[
  AGENT_WORK_DIR
  AGENT_MEMORY_FILE
  AGENT_TARGET_ROOT
].freeze

WORKDIR_GITIGNORE = "*\n!.gitignore\n!README.md\n"
LEARNED_MEMORY_BEGIN = "<!-- AGENT_LEARNED_MEMORY:BEGIN -->"
LEARNED_MEMORY_END = "<!-- AGENT_LEARNED_MEMORY:END -->"

SECRET_PATTERNS = AgentWakerValidation::SECRET_PATTERNS

SKILL_HEADINGS = [
  "Purpose",
  "Trigger Conditions",
  "Required Inputs",
  "Workflow",
  "Outputs",
  "Approval Gates",
  "Failure Handling",
  "Handoff Rules"
].freeze

phase = "integrated"
parser = OptionParser.new do |options|
  options.banner = "Usage: validate-role.rb <role-directory> [--phase standalone|integrated]"
  options.on("--phase PHASE", %w[standalone integrated], "Validation phase (default: integrated)") do |value|
    phase = value
  end
end

begin
  parser.parse!(ARGV)
rescue OptionParser::ParseError => e
  abort "#{e.message}\n#{parser}"
end

role_arg = ARGV.shift
abort parser.to_s unless role_arg && ARGV.empty?

role_dir = Pathname.new(File.expand_path(role_arg))
abort "Role directory does not exist: #{role_dir}" unless role_dir.directory?

repo_root = if role_dir.join("capabilities").directory?
              role_dir
            else
              role_dir.parent
            end
errors = []

SOUL_FILES.each do |name|
  path = role_dir.join("agent-soul", name)
  errors << "missing source file: #{path}" unless path.file?
end

%w[agent-persona.html agent-detail.zh.md agent-detail.en.md capabilities.yaml env/.env.example mcp/mcp.json].each do |relative|
  path = role_dir.join(relative)
  errors << "missing required artifact: #{path}" unless path.file?
end

profile = nil
profile_path = role_dir.join("agent-soul", "PROFILE.yaml")
if profile_path.file?
  begin
    profile = YAML.load_file(profile_path.to_s)
    errors << "PROFILE.yaml root must be a mapping" unless profile.is_a?(Hash)
  rescue StandardError => e
    errors << "PROFILE.yaml parse error: #{e.message}"
  end
end

capabilities_path = role_dir.join("capabilities.yaml")
if capabilities_path.file?
  begin
    capabilities_manifest = YAML.load_file(capabilities_path.to_s)
    errors.concat(
      AgentWakerValidation.validate_role_capabilities(
        capabilities_manifest,
        role_dir: role_dir,
        profile: profile,
        repo_root: repo_root
      )
    )
  rescue StandardError => e
    errors << "capabilities.yaml parse error: #{e.message}"
  end
end

if profile.is_a?(Hash)
  errors.concat(AgentWakerValidation.validate_profile(profile, role_dir: role_dir))
  unless role_dir == repo_root || profile["id"] == role_dir.basename.to_s
    errors << "PROFILE id does not match role directory"
  end

  runtime_env_example = role_dir.join("env", ".env.example")
  runtime_memory_path = role_dir.join("agent-soul", "MEMORY.md")
  runtime_storage_detected =
    profile.key?("runtime_storage") ||
    role_dir.join("workdir", "README.md").exist? ||
    role_dir.join("workdir", ".gitignore").exist? ||
    (runtime_env_example.file? && runtime_env_example.read(encoding: "UTF-8").match?(/^AGENT_(?:WORK_DIR|MEMORY_FILE)\s*=/)) ||
    (runtime_memory_path.file? && runtime_memory_path.read(encoding: "UTF-8").include?(LEARNED_MEMORY_BEGIN))

  if runtime_storage_detected
    runtime_storage = profile["runtime_storage"]
    if !profile.key?("runtime_storage")
      errors << "PROFILE.yaml runtime_storage is missing for the detected runtime-storage contract"
    elsif runtime_storage.is_a?(Hash)
      missing_runtime_fields = RUNTIME_STORAGE_FIELDS.keys.reject { |key| runtime_storage.key?(key) }
      errors << "PROFILE.yaml runtime_storage missing fields: #{missing_runtime_fields.join(', ')}" unless missing_runtime_fields.empty?

      RUNTIME_STORAGE_FIELDS.each do |key, expected|
        next unless runtime_storage.key?(key)

        actual = runtime_storage[key]
        errors << "PROFILE.yaml runtime_storage.#{key} must be #{expected.inspect}" unless actual == expected
      end

      unexpected_runtime_fields = runtime_storage.keys - RUNTIME_STORAGE_FIELDS.keys
      unless unexpected_runtime_fields.empty?
        errors << "PROFILE.yaml runtime_storage has unsupported fields: #{unexpected_runtime_fields.join(', ')}"
      end
    else
      errors << "PROFILE.yaml runtime_storage must be a mapping"
    end

    workdir_readme = role_dir.join("workdir", "README.md")
    workdir_gitignore = role_dir.join("workdir", ".gitignore")
    errors.concat(AgentWakerValidation.validate_workdir_readme(workdir_readme))
    errors << "missing workdir scaffold: #{workdir_gitignore}" unless workdir_gitignore.file?
    if workdir_gitignore.file? && workdir_gitignore.read(encoding: "UTF-8") != WORKDIR_GITIGNORE
      errors << "workdir/.gitignore must contain exactly *, !.gitignore, and !README.md on separate lines"
    end

    env_example = runtime_env_example
    if env_example.file?
      assignments = AgentWakerValidation.dotenv_assignments(env_example)
      RUNTIME_ENV_VARIABLES.each do |variable|
        entries = assignments[variable]
        if entries.empty?
          errors << "env/.env.example missing active #{variable} assignment"
          next
        end

        errors << "env/.env.example defines #{variable} more than once" if entries.length > 1
        value = entries.last[0]
        errors << "env/.env.example #{variable} must use a non-empty absolute-path placeholder" if value.empty? || !Pathname.new(value).absolute?
      end
    end

    memory_path = runtime_memory_path
    if memory_path.file?
      memory = memory_path.read(encoding: "UTF-8")
      begin_count = memory.scan(LEARNED_MEMORY_BEGIN).length
      end_count = memory.scan(LEARNED_MEMORY_END).length
      errors << "agent-soul/MEMORY.md must contain exactly one learned-memory BEGIN marker" unless begin_count == 1
      errors << "agent-soul/MEMORY.md must contain exactly one learned-memory END marker" unless end_count == 1
      if begin_count == 1 && end_count == 1 && memory.index(LEARNED_MEMORY_BEGIN) > memory.index(LEARNED_MEMORY_END)
        errors << "agent-soul/MEMORY.md learned-memory BEGIN marker must precede END marker"
      end
    end
  end

  skills = profile["skills"]
  if skills.is_a?(Hash) && skills["directory"]
    skill_dir = role_dir.join(skills["directory"])
    errors << "missing role skill directory: #{skill_dir}" unless skill_dir.directory?

    %w[meta_entrypoint].each do |key|
      entrypoint = skills[key]
      errors << "PROFILE.yaml skills.#{key} is missing" unless entrypoint.is_a?(String)
      errors << "broken PROFILE skill entrypoint: #{entrypoint}" if entrypoint.is_a?(String) && !role_dir.join(entrypoint).cleanpath.file?
    end

    items = skills["items"]
    if items.is_a?(Array)
      items.each do |item|
        entrypoint = item.is_a?(Hash) ? item["entrypoint"] : nil
        errors << "PROFILE skill item is missing entrypoint" unless entrypoint.is_a?(String)
        errors << "broken PROFILE skill item entrypoint: #{entrypoint}" if entrypoint.is_a?(String) && !role_dir.join(entrypoint).cleanpath.file?
      end
    else
      errors << "PROFILE.yaml skills.items must be an array"
    end
  else
    errors << "PROFILE.yaml skills.directory is missing"
  end
end

mcp_path = role_dir.join("mcp", "mcp.json")
if mcp_path.file?
  begin
    mcp = JSON.parse(mcp_path.read(encoding: "UTF-8"))
    errors.concat(
      AgentWakerValidation.validate_mcp(
        mcp,
        env_path: role_dir.join("env", ".env.example")
      )
    )
  rescue StandardError => e
    errors << "mcp/mcp.json parse error: #{e.message}"
  end
end

skill_files = Dir.glob(role_dir.join("*-skills", "**", "SKILL.md").to_s)
                 .reject { |path| AgentWakerValidation.vendored_reference?(path) }
                 .sort
errors << "no role-owned SKILL.md files found" if skill_files.empty?

skill_files.each do |skill_file|
  content = File.read(skill_file, encoding: "UTF-8")
  frontmatter = content.match(/\A---\n(.*?)\n---/m)
  errors << "missing YAML frontmatter: #{skill_file}" unless frontmatter

  if frontmatter
    begin
      metadata = YAML.safe_load(frontmatter[1])
      unless metadata.is_a?(Hash) && metadata["name"].is_a?(String) && metadata["description"].is_a?(String)
        errors << "frontmatter needs string name and description: #{skill_file}"
      end
    rescue StandardError => e
      errors << "invalid skill frontmatter in #{skill_file}: #{e.message}"
    end
  end

  SKILL_HEADINGS.each do |heading|
    errors << "#{skill_file} missing heading: ## #{heading}" unless content.match?(/^## #{Regexp.escape(heading)}$/)
  end
end

SOUL_FILES.each do |name|
  path = role_dir.join("agent-soul", name)
  next unless path.file?
  next if name == "PROFILE.yaml"

  content = path.read
  errors << "non-English authoritative content: #{path}" if content.match?(/\p{Han}/)
end

Dir.glob(role_dir.join("**", "*").to_s, File::FNM_DOTMATCH).select { |path| File.file?(path) }.each do |path|
  # Workdir is an ignored runtime data surface. Keep the tracked scaffold in
  # normal scans, but exclude task inputs, outputs, logs, and other run data.
  workdir_root = role_dir.join("workdir")
  if path.start_with?(workdir_root.to_s + File::SEPARATOR)
    workdir_relative = Pathname.new(path).relative_path_from(workdir_root).to_s
    next unless %w[README.md .gitignore].include?(workdir_relative)
  end
  next if Pathname.new(path).each_filename.include?("templates")
  next unless File.extname(path).match?(/\A\.(?:md|yaml|yml|json|html)\z/) || File.basename(path) == ".env.example"

  content = File.read(path, encoding: "UTF-8")
  errors << "unresolved placeholder in #{path}" if content.match?(/\{\{[^}]+\}\}|^\s*(?:TODO|TBD)(?::|\b)/)

  SECRET_PATTERNS.each do |label, pattern|
    errors << "possible #{label} in #{path}" if content.match?(pattern)
  end
end

renderer = Pathname.new(__dir__).join("render-agent-detail-en.rb")
stdout, stderr, status = Open3.capture3(RbConfig.ruby, renderer.to_s, role_dir.to_s, "--check")
errors << [stdout, stderr].join.strip unless status.success?

display_digest = Pathname.new(__dir__).join("sync-display-digest.rb")
if display_digest.file?
  stdout, stderr, status = Open3.capture3(RbConfig.ruby, display_digest.to_s, role_dir.to_s, "--check")
  errors << [stdout, stderr].join.strip unless status.success?
else
  errors << "missing display digest validator: #{display_digest}"
end

errors.concat(
  AgentWakerValidation.display_authority_errors(
    [role_dir.join("agent-detail.zh.md"), role_dir.join("agent-persona.html")]
  )
)

role_id = if role_dir == repo_root && profile.is_a?(Hash)
            profile["id"].to_s
          else
            role_dir.basename.to_s
          end
if phase == "integrated"
  team_path = repo_root.join("agent-team.html")
  team = nil
  if team_path.file?
    team = team_path.read
    card = AgentWakerValidation.team_card_block(team, role_id)
    errors << "agent-team.html has no card for #{role_id}" unless card

    if profile.is_a?(Hash) && profile["generation"].is_a?(Hash)
      %w[card_title_zh card_subtitle_zh card_focus_zh card_mission_zh].each do |key|
        value = profile["generation"][key]
        errors << "PROFILE generation.#{key} is missing" unless value.is_a?(String) && !value.empty?
        errors << "target agent-team.html card does not reflect generation.#{key}" if card && value.is_a?(String) && !card.include?(value)
      end
    end
  else
    errors << "missing repository team index: #{team_path}"
  end

  %w[README.md README.zh-CN.md].each do |name|
    path = repo_root.join(name)
    if path.file?
      role_row = path.read.lines.find { |line| line.match?(/^\| #{Regexp.escape(role_id)} \|/) }
      errors << "#{name} has no role-list row for #{role_id}" unless role_row
      errors << "#{name} role row does not include display_name" if role_row && profile.is_a?(Hash) && !role_row.include?(profile["display_name"].to_s)
    else
      errors << "missing repository index: #{path}"
    end
  end

  profiles = Dir.glob(repo_root.join("*", "agent-soul", "PROFILE.yaml").to_s)
  profile_records = profiles.map do |path|
    parsed = YAML.load_file(path)
    next unless parsed.is_a?(Hash)

    [path, parsed["id"], parsed.dig("generation", "theme", "accent")]
  rescue StandardError
    nil
  end.compact

  if profile.is_a?(Hash)
    duplicate_ids = profile_records.select { |_, id, _| id == profile["id"] }
    errors << "duplicate role id: #{profile['id']}" if duplicate_ids.length > 1

    accent = profile.dig("generation", "theme", "accent")
    duplicate_accents = profile_records.select { |_, _, color| color.to_s.downcase == accent.to_s.downcase }
    errors << "duplicate role theme accent: #{accent}" if !accent.to_s.empty? && duplicate_accents.length > 1

    profile_records.each do |other_profile_path, other_id, _|
      next if other_id == profile["id"]

      other_role_dir = Pathname.new(other_profile_path).parent.parent
      similarity = AgentWakerValidation.semantic_similarity(role_dir, other_role_dir)
      if similarity >= AgentWakerValidation::SEMANTIC_CLONE_THRESHOLD
        errors << format(
          "semantic clone risk: identity/persona/capability/delivery similarity with %s is %.3f (threshold %.2f)",
          other_id,
          similarity,
          AgentWakerValidation::SEMANTIC_CLONE_THRESHOLD
        )
      end
    end

    registered_ids = profile_records.map { |_, id, _| id }.compact
    handoff_targets = profile["handoff_targets"]
    if handoff_targets.is_a?(Array)
      handoff_targets.each do |target|
        role = target.is_a?(Hash) ? target["role"] : nil
        errors << "unresolvable PROFILE handoff target: #{role.inspect}" unless role.is_a?(String) && registered_ids.include?(role)
      end
    else
      errors << "PROFILE.yaml handoff_targets must be an array"
    end
  end

  if team
    registered_roles = team.scan(/href="([^"\/]+)\/agent-persona\.html"/).flatten.sort
    actual_roles = Dir.glob(repo_root.join("*", "agent-persona.html").to_s).map { |path| File.basename(File.dirname(path)) }.sort
    errors << "agent-team.html registration set does not match role directories" unless registered_roles == actual_roles

    card_themes = team.scan(/<a class="card" href="([^"\/]+)\/agent-persona\.html">\s*<div class="card-top"[^#]*(#[0-9a-f]{6})/im)
    target_card_theme = card_themes.find { |registered_role, _| registered_role == role_id }
    profile_accent = profile.dig("generation", "theme", "accent") if profile.is_a?(Hash)
    if target_card_theme && profile_accent
      errors << "PROFILE theme accent does not match agent-team.html card" unless target_card_theme[1].downcase == profile_accent.downcase
      colliding_cards = card_themes.select { |_, color| color.downcase == target_card_theme[1].downcase }
      errors << "duplicate agent-team.html card accent: #{target_card_theme[1]}" if colliding_cards.length > 1
    end

    declared_count = team[/(\d+) ROLES/, 1]
    errors << "agent-team.html displayed role count does not match cards" if declared_count && declared_count.to_i != registered_roles.length
  end
end

markdown_paths = [role_dir.join("agent-detail.zh.md")] +
                 SOUL_FILES.select { |name| name.end_with?(".md") }.map { |name| role_dir.join("agent-soul", name) } +
                 skill_files.map { |path| Pathname.new(path) }
markdown_paths.each do |path|
  next unless path.file?

  path.read.scan(/\[[^\]]+\]\(([^)]+)\)/).flatten.each do |reference|
    reference = reference.split(/\s+/, 2).first.to_s
    next if reference.empty? || reference.match?(/\A(?:https?:|mailto:|#)/)

    local_path = reference.split("#", 2).first
    resolved = path.dirname.join(local_path).cleanpath
    errors << "broken local Markdown reference in #{path}: #{reference}" unless resolved.exist?
  end
end

html_path = role_dir.join("agent-persona.html")
if html_path.file?
  html = html_path.read
  html.scan(/(?:href|src)="([^"]+)"/).flatten.each do |reference|
    next if reference.match?(/\A(?:https?:|mailto:|#|javascript:)/)

    resolved = role_dir.join(reference).cleanpath
    errors << "broken local HTML reference: #{reference}" unless resolved.exist?
  end
end

if errors.empty?
  puts "PASS: #{role_id} #{phase} schema, MCP, evidence, language, link, display, runtime, and secret checks"
else
  warn "FAIL: #{role_id}"
  errors.uniq.each { |error| warn "- #{error}" }
  exit 1
end
