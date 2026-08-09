# frozen_string_literal: true

require "json"
require "pathname"
require "set"
require "time"
require "yaml"

module AgentWakerValidation
  PROFILE_SCHEMA_VERSION = "2.1"
  QUALITY_TEST_KEYS = %w[
    necessity
    replacement
    pressure
    authority
    truth
    evolution
  ].freeze

  PROFILE_SCHEMA_PATH = Pathname.new(__dir__).join("../../schemas/profile-v2.1.schema.json").expand_path.freeze
  MCP_SCHEMA_PATH = Pathname.new(__dir__).join("../../schemas/mcp.schema.json").expand_path.freeze
  RUN_RECORD_SCHEMA_PATH = Pathname.new(__dir__).join("../../schemas/run-record.schema.json").expand_path.freeze
  CAPABILITY_SCHEMA_PATH = Pathname.new(__dir__).join("../../schemas/capability.schema.json").expand_path.freeze
  ROLE_CAPABILITIES_SCHEMA_PATH = Pathname.new(__dir__).join("../../schemas/role-capabilities.schema.json").expand_path.freeze

  PLACEHOLDER_PATTERN = /\{\{[^}]+\}\}/
  ENV_REFERENCE_PATTERN = /\$\{([^}]*)\}/
  VALID_ENV_NAME_PATTERN = /\A[A-Za-z_][A-Za-z0-9_]*\z/
  MCP_SERVER_NAME_PATTERN = /\A[A-Za-z0-9][A-Za-z0-9._-]*\z/

  SECRET_PATTERNS = {
    "OpenAI-style secret" => /\bsk-(?!x{8,}\b)[A-Za-z0-9_-]{20,}\b/i,
    "GitHub token" => /\b(?:ghp|github_pat)_(?!x{8,}\b)[A-Za-z0-9_]{20,}\b/i,
    "AWS access key" => /\bAKIA(?!X{8,}\b)[0-9A-Z]{16}\b/,
    "Authorization bearer token" => /\b(?:authorization[ \t]*[:=][ \t]*)?bearer[ \t]+(?!(?:YOUR_|EXAMPLE_|REDACTED|x{8,}))[A-Za-z0-9._~+\/=:-]{20,}\b/i,
    "JWT" => /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    "Basic authorization value" => /\bauthorization[ \t]*[:=][ \t]*basic[ \t]+(?!(?:YOUR_|EXAMPLE_|REDACTED|x{8,}))[A-Za-z0-9+\/=]{16,}\b/i,
    "Cookie or session value" => /(?:cookie|set-cookie|session(?:_id|_token)?)[ \t]*[:=][ \t]*["']?(?!(?:YOUR_|EXAMPLE_|REDACTED|[A-Za-z0-9_\/+.-]*x{8,}))[A-Za-z0-9._~+\/=:-]{20,}/i,
    "private key material" => /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/i,
    # Horizontal whitespace is intentional: an empty TOKEN= placeholder must
    # not consume the next environment-variable line as its value.
    "assigned credential-like value" => /(?:token|password|secret|api[_-]?key)[ \t]*[:=][ \t]*["']?(?!(?:YOUR_|SEC_YOUR_|EXAMPLE_|[A-Za-z0-9_\/+.-]*x{8,}))[A-Za-z0-9_\/+.-]{16,}/i
  }.freeze

  WORKDIR_README_CONTRACT_REFERENCES = %w[
    schemas/run-record.schema.json
    agent-runtime-policy.yaml
    agent-runtime.rb
  ].freeze
  SEMANTIC_DISTINCTIVENESS_FILES = %w[
    agent-soul/IDENTITY.md
    agent-soul/PERSONA.md
    agent-soul/CORE_CAPABILITIES.md
    agent-soul/DELIVERY_COMMITMENTS.md
  ].freeze
  SEMANTIC_CLONE_THRESHOLD = 0.65
  DISPLAY_AUTHORITY_BYPASS_PATTERNS = {
    "unapproved production or account mutation claim" => /(?:无需|不需|无须)[^。！？；;\n]{0,16}(?:审批|确认|授权)[^。！？；;\n]{0,24}(?:直接)?(?:部署|发布|删除|修改|写入|执行|变更)[^。！？；;\n]{0,24}(?:生产|线上|真实用户|用户账户|用户账号|账户|账号)|(?:可|可以|允许)[^。！？；;\n]{0,12}(?:在)?(?:无需|不需|无须)(?:审批|确认|授权)[^。！？；;\n]{0,24}(?:直接)?(?:部署|发布|删除|修改|写入|执行|变更)/,
    "automatic destructive or identity-bound claim" => /(?:全权|自动|自主).{0,16}(?:部署生产|生产部署|正式发布|删除生产|删除数据|修改真实用户|修改用户账?户|外部写入)/m,
    "English approval bypass claim" => /(?:without|no)\s+(?:user\s+)?(?:approval|confirmation|authorization)[^.!?;\n]{0,48}(?:deploy|publish|delete|modify|write|mutate|execute)[^.!?;\n]{0,32}(?:production|live|account|identity|external)/i
  }.freeze

  class SchemaValidator
    TYPE_CHECKS = {
      "array" => ->(value) { value.is_a?(Array) },
      "boolean" => ->(value) { value.equal?(true) || value.equal?(false) },
      "integer" => ->(value) { value.is_a?(Integer) },
      "null" => ->(value) { value.nil? },
      "number" => ->(value) { value.is_a?(Numeric) },
      "object" => ->(value) { value.is_a?(Hash) },
      "string" => ->(value) { value.is_a?(String) }
    }.freeze

    def initialize(root_schema)
      @root_schema = root_schema
    end

    def validate(instance)
      validate_node(instance, @root_schema, "$")
    end

    private

    def validate_node(instance, schema, path)
      return [] if schema.equal?(true)
      return ["#{path}: is not allowed"] if schema.equal?(false)
      return ["#{path}: schema must be an object or boolean"] unless schema.is_a?(Hash)

      if schema.key?("$ref")
        referenced_errors = validate_node(instance, resolve_reference(schema.fetch("$ref")), path)
        sibling_schema = schema.reject { |key, _| key == "$ref" }
        return referenced_errors if sibling_schema.empty?

        return referenced_errors + validate_node(instance, sibling_schema, path)
      end

      errors = []
      errors.concat(validate_combinators(instance, schema, path))

      if schema.key?("const") && instance != schema["const"]
        errors << "#{path}: must equal #{schema['const'].inspect}"
      end
      if schema.key?("enum") && !schema["enum"].include?(instance)
        errors << "#{path}: must be one of #{schema['enum'].map(&:inspect).join(', ')}"
      end

      if schema.key?("type")
        allowed_types = Array(schema["type"])
        unless allowed_types.any? { |type| TYPE_CHECKS.fetch(type).call(instance) }
          errors << "#{path}: must be #{allowed_types.join(' or ')}, got #{ruby_type(instance)}"
          return errors
        end
      end

      errors.concat(validate_string(instance, schema, path)) if instance.is_a?(String)
      errors.concat(validate_number(instance, schema, path)) if instance.is_a?(Numeric)
      errors.concat(validate_array(instance, schema, path)) if instance.is_a?(Array)
      errors.concat(validate_object(instance, schema, path)) if instance.is_a?(Hash)
      errors
    end

    def validate_combinators(instance, schema, path)
      errors = []

      Array(schema["allOf"]).each do |branch|
        errors.concat(validate_node(instance, branch, path))
      end

      if schema.key?("anyOf")
        matches = schema.fetch("anyOf").count { |branch| validate_node(instance, branch, path).empty? }
        errors << "#{path}: must match at least one allowed schema" if matches.zero?
      end

      if schema.key?("oneOf")
        matches = schema.fetch("oneOf").count { |branch| validate_node(instance, branch, path).empty? }
        errors << "#{path}: must match exactly one allowed schema (matched #{matches})" unless matches == 1
      end

      if schema.key?("not") && validate_node(instance, schema.fetch("not"), path).empty?
        errors << "#{path}: matches a forbidden schema"
      end

      if schema.key?("if")
        condition_matches = validate_node(instance, schema.fetch("if"), path).empty?
        branch = condition_matches ? schema["then"] : schema["else"]
        errors.concat(validate_node(instance, branch, path)) if branch
      end

      errors
    end

    def validate_string(instance, schema, path)
      errors = []
      if schema.key?("minLength") && instance.length < schema["minLength"]
        errors << "#{path}: must contain at least #{schema['minLength']} characters"
      end
      if schema.key?("maxLength") && instance.length > schema["maxLength"]
        errors << "#{path}: must contain at most #{schema['maxLength']} characters"
      end
      if schema.key?("pattern") && !Regexp.new(schema["pattern"]).match?(instance)
        errors << "#{path}: must match #{schema['pattern'].inspect}"
      end
      if schema["format"] == "date-time"
        begin
          Time.iso8601(instance)
        rescue ArgumentError
          errors << "#{path}: must be a valid ISO-8601 date-time"
        end
      end
      errors
    end

    def validate_array(instance, schema, path)
      errors = []
      if schema.key?("minItems") && instance.length < schema["minItems"]
        errors << "#{path}: must contain at least #{schema['minItems']} items"
      end
      if schema.key?("maxItems") && instance.length > schema["maxItems"]
        errors << "#{path}: must contain at most #{schema['maxItems']} items"
      end
      if schema["uniqueItems"] && instance.uniq.length != instance.length
        errors << "#{path}: items must be unique"
      end
      if schema["items"].is_a?(Hash) || [true, false].include?(schema["items"])
        instance.each_with_index do |item, index|
          errors.concat(validate_node(item, schema["items"], "#{path}[#{index}]"))
        end
      end
      errors
    end

    def validate_number(instance, schema, path)
      errors = []
      if schema.key?("minimum") && instance < schema["minimum"]
        errors << "#{path}: must be greater than or equal to #{schema['minimum']}"
      end
      if schema.key?("maximum") && instance > schema["maximum"]
        errors << "#{path}: must be less than or equal to #{schema['maximum']}"
      end
      errors
    end

    def validate_object(instance, schema, path)
      errors = []
      Array(schema["required"]).each do |key|
        errors << "#{path}: missing required property #{key.inspect}" unless instance.key?(key)
      end

      if schema.key?("minProperties") && instance.length < schema["minProperties"]
        errors << "#{path}: must contain at least #{schema['minProperties']} properties"
      end

      properties = schema.fetch("properties", {})
      properties.each do |key, property_schema|
        next unless instance.key?(key)

        errors.concat(validate_node(instance[key], property_schema, child_path(path, key)))
      end

      unknown_keys = instance.keys - properties.keys
      additional = schema.fetch("additionalProperties", true)
      unknown_keys.each do |key|
        if additional.equal?(false)
          errors << "#{path}: unsupported property #{key.inspect}"
        elsif additional.is_a?(Hash) || [true, false].include?(additional)
          errors.concat(validate_node(instance[key], additional, child_path(path, key)))
        end
      end
      errors
    end

    def resolve_reference(reference)
      unless reference.start_with?("#/")
        raise ArgumentError, "only local JSON Schema references are supported: #{reference}"
      end

      reference.delete_prefix("#/").split("/").reduce(@root_schema) do |node, token|
        decoded = token.gsub("~1", "/").gsub("~0", "~")
        node.fetch(decoded)
      end
    end

    def child_path(path, key)
      key.match?(/\A[A-Za-z_][A-Za-z0-9_]*\z/) ? "#{path}.#{key}" : "#{path}[#{key.inspect}]"
    end

    def ruby_type(value)
      case value
      when Hash then "object"
      when Array then "array"
      when String then "string"
      when Integer then "integer"
      when Numeric then "number"
      when TrueClass, FalseClass then "boolean"
      when NilClass then "null"
      else value.class.to_s
      end
    end
  end

  module_function

  def load_schema(path)
    JSON.parse(Pathname.new(path).read(encoding: "UTF-8"))
  end

  def validate_against_schema(value, path)
    SchemaValidator.new(load_schema(path)).validate(value)
  end

  def validate_profile(profile, role_dir:, template: false)
    errors = validate_against_schema(profile, PROFILE_SCHEMA_PATH).map { |error| "PROFILE.yaml schema #{error}" }
    return errors unless profile.is_a?(Hash)

    unless template
      errors << "PROFILE.yaml schema_version must be #{PROFILE_SCHEMA_VERSION.inspect}" unless profile["schema_version"] == PROFILE_SCHEMA_VERSION
    end

    quality_tests = profile["quality_tests"]
    if quality_tests.is_a?(Hash)
      quality_tests.each do |name, quality_test|
        next unless quality_test.is_a?(Hash)

        status = quality_test["status"]
        if template
          unless %w[pass pending].include?(status)
            errors << "PROFILE.yaml quality_tests.#{name}.status must be pass or pending in the template"
          end
        elsif status != "pass"
          errors << "PROFILE.yaml quality_tests.#{name}.status must be pass for a formal role"
        end

        Array(quality_test["evidence"]).each do |reference|
          next unless reference.is_a?(String)
          next if template && reference.match?(PLACEHOLDER_PATTERN)

          errors.concat(validate_evidence_reference(role_dir, name, reference))
        end
      end
    end

    errors.concat(validate_skill_references(profile["skills"], role_dir: role_dir, template: template))
    errors.concat(profile_language_errors(profile))
    errors
  end

  def validate_skill_references(skills, role_dir:, template: false)
    return [] unless skills.is_a?(Hash)

    references = [
      ["skills.directory", skills["directory"], :directory],
      ["skills.meta_entrypoint", skills["meta_entrypoint"], :file],
      ["skills.env_example", skills["env_example"], :file]
    ]
    Array(skills["items"]).each_with_index do |item, index|
      next unless item.is_a?(Hash)

      references << ["skills.items[#{index}].entrypoint", item["entrypoint"], :file]
    end

    errors = references.flat_map do |label, reference, expected_type|
      next [] unless reference.is_a?(String)
      next [] if template && reference.match?(PLACEHOLDER_PATTERN)

      validate_role_local_path(role_dir, "PROFILE.yaml #{label}", reference, expected_type)
    end

    item_ids = Array(skills["items"]).select { |item| item.is_a?(Hash) }.map { |item| item["id"] }
    duplicate_ids = item_ids.compact.group_by(&:itself).select { |_, values| values.length > 1 }.keys
    errors << "PROFILE.yaml skills.items has duplicate ids: #{duplicate_ids.join(', ')}" unless duplicate_ids.empty?
    errors
  end

  def validate_role_local_path(role_dir, label, reference, expected_type)
    path = Pathname.new(reference)
    return ["#{label} must use a role-relative path: #{reference.inspect}"] if path.absolute?

    root = Pathname.new(role_dir).expand_path
    resolved = root.join(path).cleanpath
    unless resolved.to_s.start_with?(root.to_s + File::SEPARATOR)
      return ["#{label} escapes the role directory: #{reference.inspect}"]
    end

    exists = expected_type == :directory ? resolved.directory? : resolved.file?
    return ["#{label} does not reference an existing #{expected_type}: #{reference.inspect}"] unless exists

    begin
      real_root = root.realpath
      real_resolved = resolved.realpath
      unless real_resolved.to_s.start_with?(real_root.to_s + File::SEPARATOR)
        return ["#{label} resolves outside the role directory: #{reference.inspect}"]
      end
    rescue Errno::ENOENT
      return ["#{label} does not reference an existing #{expected_type}: #{reference.inspect}"]
    end

    []
  end

  def validate_evidence_reference(role_dir, test_name, reference)
    label = "PROFILE.yaml quality_tests.#{test_name}.evidence"
    validate_role_local_path(role_dir, label, reference, :file)
  end

  def validate_role_capabilities(manifest, role_dir:, profile:, repo_root:, template: false)
    errors = validate_against_schema(manifest, ROLE_CAPABILITIES_SCHEMA_PATH).map do |error|
      "capabilities.yaml schema #{error}"
    end
    return errors unless manifest.is_a?(Hash)

    standalone_root = Pathname.new(role_dir).expand_path == Pathname.new(repo_root).expand_path
    role_id = if standalone_root && profile.is_a?(Hash) && !profile["id"].to_s.empty?
                profile["id"].to_s
              else
                Pathname.new(role_dir).basename.to_s
              end
    unless template
      errors << "capabilities.yaml role must match role directory" unless manifest["role"] == role_id
    end

    skill_ids = Array(profile.is_a?(Hash) && profile.dig("skills", "items"))
                .select { |item| item.is_a?(Hash) }
                .map { |item| item["id"] }
                .compact
    capability_ids = []

    Array(manifest["capabilities"]).each_with_index do |dependency, index|
      next unless dependency.is_a?(Hash)

      capability_id = dependency["id"]
      capability_ids << capability_id if capability_id
      capability_path = Pathname.new(repo_root).join("capabilities", capability_id.to_s, "CAPABILITY.yaml")
      unless capability_path.file?
        errors << "capabilities.yaml capabilities[#{index}] references unknown capability: #{capability_id.inspect}"
        next
      end

      begin
        capability = YAML.load_file(capability_path.to_s)
        errors.concat(validate_shared_capability(capability, capability_dir: capability_path.dirname))
        if capability.is_a?(Hash)
          errors << "capability manifest id mismatch for #{capability_id}" unless capability["id"] == capability_id
          requested = dependency["version"]
          resolved = capability["version"]
          unless template || compatible_version?(requested, resolved)
            errors << "capabilities.yaml #{capability_id} version #{requested.inspect} does not accept #{resolved.inspect}"
          end

          profile_ids = Array(capability["profiles"]).map { |item| item["id"] if item.is_a?(Hash) }.compact
          Array(dependency["used_by"]).each do |usage|
            next unless usage.is_a?(Hash)

            errors << "capabilities.yaml #{capability_id} references unknown role skill: #{usage['skill'].inspect}" unless skill_ids.include?(usage["skill"])
            errors << "capabilities.yaml #{capability_id} references unknown capability profile: #{usage['profile'].inspect}" unless profile_ids.include?(usage["profile"])
          end

          if dependency.dig("permissions", "account_actions") && !capability.dig("permissions", "supports_account_actions")
            errors << "capabilities.yaml #{capability_id} cannot grant account actions unsupported by the shared capability"
          end
        end
      rescue StandardError => e
        errors << "invalid capability manifest #{capability_path}: #{e.message}"
      end
    end

    duplicates = capability_ids.compact.group_by(&:itself).select { |_, values| values.length > 1 }.keys
    errors << "capabilities.yaml has duplicate capability ids: #{duplicates.join(', ')}" unless duplicates.empty?
    errors
  end

  def validate_shared_capability(capability, capability_dir:)
    errors = validate_against_schema(capability, CAPABILITY_SCHEMA_PATH).map do |error|
      "CAPABILITY.yaml schema #{error}"
    end
    return errors unless capability.is_a?(Hash)

    errors << "CAPABILITY.yaml id must match directory" unless capability["id"] == Pathname.new(capability_dir).basename.to_s
    %w[entrypoint].each do |key|
      errors.concat(validate_role_local_path(capability_dir, "CAPABILITY.yaml #{key}", capability[key], :file)) if capability[key].is_a?(String)
    end
    contracts = capability["contracts"]
    if contracts.is_a?(Hash)
      %w[input_schema output_schema].each do |key|
        errors.concat(validate_role_local_path(capability_dir, "CAPABILITY.yaml contracts.#{key}", contracts[key], :file)) if contracts[key].is_a?(String)
      end
    end
    errors
  end

  def compatible_version?(requirement, version)
    return false unless requirement.is_a?(String) && version.is_a?(String)

    requested = requirement.sub(/\A[~^]|\A>=?/, "")
    requested_parts = requested.split(".").first(3).map(&:to_i)
    version_parts = version.split(".").first(3).map(&:to_i)
    at_least_requested = (version_parts <=> requested_parts) >= 0
    return version_parts[0] == requested_parts[0] && at_least_requested if requirement.start_with?("^")
    return version_parts[0, 2] == requested_parts[0, 2] && at_least_requested if requirement.start_with?("~")
    return at_least_requested if requirement.start_with?(">")

    version == requirement
  end

  def profile_language_errors(profile)
    errors = []
    walk_profile_values(profile) do |value, path, chinese_allowed|
      next unless value.is_a?(String) && value.match?(/\p{Han}/)
      next if chinese_allowed

      errors << "non-English PROFILE value outside a *_zh field at #{path}"
    end
    errors
  end

  def walk_profile_values(value, path = "$", chinese_allowed = false, &block)
    case value
    when Hash
      value.each do |key, child|
        child_path = key.match?(/\A[A-Za-z_][A-Za-z0-9_]*\z/) ? "#{path}.#{key}" : "#{path}[#{key.inspect}]"
        walk_profile_values(child, child_path, key.end_with?("_zh"), &block)
      end
    when Array
      value.each_with_index { |child, index| walk_profile_values(child, "#{path}[#{index}]", chinese_allowed, &block) }
    else
      yield value, path, chinese_allowed
    end
  end

  def validate_mcp(mcp, env_path:, template: false)
    errors = validate_against_schema(mcp, MCP_SCHEMA_PATH).map { |error| "mcp/mcp.json schema #{error}" }
    return errors unless mcp.is_a?(Hash)

    servers = mcp["mcpServers"]
    if servers.is_a?(Hash)
      servers.each_key do |name|
        unless name.is_a?(String) && name.match?(MCP_SERVER_NAME_PATTERN)
          errors << "mcp/mcp.json server name must use letters, digits, dot, underscore, or hyphen: #{name.inspect}"
        end
      end
    end

    references = environment_references(mcp)
    malformed = references.reject { |name| name.match?(VALID_ENV_NAME_PATTERN) }
    malformed.each { |name| errors << "mcp/mcp.json has malformed environment reference: ${#{name}}" }

    assignments = dotenv_assignments(env_path)
    (references - malformed).uniq.sort.each do |name|
      next if assignments.key?(name)
      next if template && name.match?(PLACEHOLDER_PATTERN)

      errors << "mcp/mcp.json references #{name}, but env/.env.example has no active assignment"
    end
    errors
  end

  def environment_references(value)
    case value
    when Hash
      value.flat_map { |key, child| environment_references(key.to_s) + environment_references(child) }
    when Array
      value.flat_map { |child| environment_references(child) }
    when String
      value.scan(ENV_REFERENCE_PATTERN).flatten
    else
      []
    end
  end

  def dotenv_assignments(path)
    assignments = Hash.new { |hash, key| hash[key] = [] }
    pathname = Pathname.new(path)
    return assignments unless pathname.file?

    pathname.each_line.with_index(1) do |line, line_number|
      stripped = line.sub(/\A\uFEFF/, "").strip
      next if stripped.empty? || stripped.start_with?("#")

      match = stripped.match(/\A(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\z/)
      next unless match

      assignments[match[1]] << [dotenv_value(match[2]), line_number]
    end
    assignments
  end

  def dotenv_value(raw_value)
    value = raw_value.to_s.strip
    quoted = value.match(/\A(['"])(.*?)\1(?:\s+#.*)?\z/m)
    return quoted[2] if quoted

    value.sub(/\s+#.*\z/, "").strip
  end

  def vendored_reference?(path)
    pathname = Pathname.new(path)
    parts = pathname.each_filename.to_a
    return false unless parts.include?("references")

    parts.include?("jpage-official") || pathname.basename.to_s.start_with?("upstream-")
  end

  def validate_workdir_readme(path)
    pathname = Pathname.new(path)
    return ["missing workdir scaffold: #{pathname}"] unless pathname.file?

    content = pathname.read(encoding: "UTF-8")
    WORKDIR_README_CONTRACT_REFERENCES.each_with_object([]) do |reference, errors|
      errors << "workdir/README.md must reference #{reference}" unless content.include?(reference)
    end
  end

  def team_card_block(html, role_id)
    html.to_s.scan(/<a\b[^>]*>.*?<\/a>/mi).find do |block|
      opening = block[/\A<a\b[^>]*>/mi].to_s
      opening.match?(/\bclass="[^"]*\bcard\b[^"]*"/i) &&
        opening.include?("href=\"#{role_id}/agent-persona.html\"")
    end
  end

  def semantic_shingles(role_dir, width = 5)
    text = SEMANTIC_DISTINCTIVENESS_FILES.map do |relative|
      path = Pathname.new(role_dir).join(relative)
      path.read(encoding: "UTF-8") if path.file?
    end.compact.join("\n")
    words = text.downcase.scan(/[a-z0-9]+/)
    return Set.new(words) if words.length < width

    Set.new(words.each_cons(width).map { |tokens| tokens.join(" ") })
  end

  def semantic_similarity(left_role_dir, right_role_dir)
    left = semantic_shingles(left_role_dir)
    right = semantic_shingles(right_role_dir)
    return 0.0 if left.empty? || right.empty?

    union = left | right
    return 0.0 if union.empty?

    (left & right).length.to_f / union.length
  end

  def display_authority_errors(paths)
    Array(paths).each_with_object([]) do |path, errors|
      pathname = Pathname.new(path)
      next unless pathname.file?

      content = pathname.read(encoding: "UTF-8")
      DISPLAY_AUTHORITY_BYPASS_PATTERNS.each do |label, pattern|
        errors << "unsupported display authority claim (#{label}) in #{pathname}" if content.match?(pattern)
      end
    end
  end
end
