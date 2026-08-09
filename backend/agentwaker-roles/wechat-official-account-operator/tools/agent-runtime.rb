#!/usr/bin/env ruby
# frozen_string_literal: true

# Dependency-free Workdir v1 lifecycle runner for AgentWaker roles.

require "date"
require "digest"
require "fileutils"
require "json"
require "optparse"
require "open3"
require "pathname"
require "rbconfig"
require "securerandom"
require "time"
require "yaml"

require_relative "lib/validation"

module AgentRuntime
  SCHEMA_VERSION = "1.0"
  SENTINEL_NAME = ".agentwaker-workdir.yaml"
  RUN_FILE_NAME = "run.yaml"
  PROPOSAL_FILE_NAME = "memory-update-proposal.md"
  RUN_SUBDIRECTORIES = %w[input raw intermediate output evidence logs tmp].freeze
  RUN_STATUSES = %w[active complete partial blocked failed cancelled].freeze
  TERMINAL_STATUSES = %w[complete partial blocked failed cancelled].freeze
  MEMORY_STATUSES = %w[pending none promoted proposal-only conflict].freeze
  MEMORY_TYPES = %w[preference correction decision lesson procedure].freeze
  MEMORY_SCOPES = %w[agent project user].freeze
  MEMORY_ENTRY_KEYS = %w[id title type scope memory evidence verified_at reuse_when supersedes].freeze
  MEMORY_ID_PATTERN = /\AMEM-[0-9]{8}-[0-9]{3}\z/.freeze
  SHA256_PATTERN = /\A[0-9a-f]{64}\z/.freeze
  RUN_ID_PATTERN = /\A[A-Za-z0-9][A-Za-z0-9._-]{0,127}\z/.freeze
  LEARNED_BEGIN = "<!-- AGENT_LEARNED_MEMORY:BEGIN -->"
  LEARNED_END = "<!-- AGENT_LEARNED_MEMORY:END -->"

  DEFAULT_POLICY = {
    "schema_version" => "1.0",
    "run_record_schema" => "schemas/run-record.schema.json",
    "close_requirements" => {
      "complete" => { "minimum_outputs" => 1, "minimum_evidence" => 1, "minimum_residual_work" => 0, "maximum_residual_work" => 0 },
      "partial" => { "minimum_outputs" => 1, "minimum_evidence" => 1, "minimum_residual_work" => 1 },
      "blocked" => { "minimum_outputs" => 0, "minimum_evidence" => 1, "minimum_residual_work" => 1 },
      "failed" => { "minimum_outputs" => 0, "minimum_evidence" => 1, "minimum_residual_work" => 1 },
      "cancelled" => { "minimum_outputs" => 0, "minimum_evidence" => 0, "minimum_residual_work" => 1 }
    },
    "retention" => {
      "clear_terminal_tmp_after_days" => 7,
      "archive_terminal_runs_after_days" => 30,
      "delete_archives_after_days" => nil,
      "preserve_memory_conflicts" => true
    }
  }.freeze

  class Error < StandardError
    attr_reader :exit_code

    def initialize(message, exit_code = 1)
      super(message)
      @exit_code = exit_code
    end
  end

  module_function

  def repo_root
    @repo_root ||= Pathname.new(__dir__).join("..").expand_path
  end

  def now_utc
    Time.now.utc
  end

  def iso8601(time)
    time.utc.iso8601
  end

  def safe_yaml_load(text, label)
    value = begin
      YAML.safe_load(text, :permitted_classes => [], :permitted_symbols => [], :aliases => false)
    rescue ArgumentError
      # Psych 3 on the oldest supported Ruby uses positional arguments.
      YAML.safe_load(text, [], [], false)
    end
    raise Error, "#{label} must contain a YAML mapping" unless value.is_a?(Hash)

    stringify_keys(value)
  rescue Psych::Exception => e
    raise Error, "#{label} is invalid YAML: #{e.message}"
  end

  def load_yaml(path, label)
    raise Error, "#{label} does not exist: #{path}" unless path.file?
    raise Error, "#{label} must not be a symbolic link: #{path}" if path.symlink?

    safe_yaml_load(path.read(encoding: "UTF-8"), label)
  rescue Errno::EACCES => e
    raise Error, "#{label} is not readable: #{path} (#{e.message})"
  end

  def load_legacy_yaml(path)
    raise Error, "legacy run record does not exist: #{path}" unless path.file?
    raise Error, "legacy run record must not be a symbolic link: #{path}" if path.symlink?
    text = path.read(encoding: "UTF-8")
    value = begin
      YAML.safe_load(text, :permitted_classes => [Date, Time], :permitted_symbols => [], :aliases => false)
    rescue ArgumentError
      YAML.safe_load(text, [Date, Time], [], false)
    end
    raise Error, "legacy run record must contain a YAML mapping" unless value.is_a?(Hash)
    stringify_keys(normalize_legacy_scalars(value))
  rescue Psych::Exception => e
    raise Error, "legacy run record is invalid YAML: #{e.message}"
  end

  def normalize_legacy_scalars(value)
    case value
    when Hash
      value.each_with_object({}) { |(key, item), result| result[key] = normalize_legacy_scalars(item) }
    when Array
      value.map { |item| normalize_legacy_scalars(item) }
    when Time
      iso8601(value)
    when Date
      value.iso8601
    else
      value
    end
  end

  def stringify_keys(value)
    case value
    when Hash
      value.each_with_object({}) { |(key, item), result| result[key.to_s] = stringify_keys(item) }
    when Array
      value.map { |item| stringify_keys(item) }
    else
      value
    end
  end

  def deep_copy(value)
    Marshal.load(Marshal.dump(value))
  end

  def deep_merge(base, overlay)
    result = deep_copy(base)
    overlay.each do |key, value|
      result[key] = if result[key].is_a?(Hash) && value.is_a?(Hash)
                      deep_merge(result[key], value)
                    else
                      deep_copy(value)
                    end
    end
    result
  end

  def sha256_file(path)
    Digest::SHA256.file(path.to_s).hexdigest
  end

  def atomic_write(path, content, mode)
    path = Pathname.new(path)
    path.dirname.mkpath
    temporary = path.dirname.join(".#{path.basename}.tmp-#{Process.pid}-#{SecureRandom.hex(6)}")
    flags = File::WRONLY | File::CREAT | File::EXCL
    File.open(temporary.to_s, flags, mode) do |file|
      file.binmode
      file.write(content)
      file.flush
      file.fsync
    end
    File.rename(temporary.to_s, path.to_s)
    File.chmod(mode, path.to_s)
  ensure
    File.unlink(temporary.to_s) if defined?(temporary) && temporary && temporary.exist?
  end

  def atomic_yaml_write(path, value, mode = 0o600)
    atomic_write(path, YAML.dump(value), mode)
  end

  def parse_iso8601(value, label)
    raise Error, "#{label} must be a non-empty ISO-8601 string" unless value.is_a?(String) && !value.strip.empty?

    Time.iso8601(value)
  rescue ArgumentError
    raise Error, "#{label} is not valid ISO-8601: #{value.inspect}"
  end

  def absolute_path(value, label)
    raise Error, "#{label} is required" if value.to_s.strip.empty?

    path = Pathname.new(value.to_s)
    raise Error, "#{label} must be an absolute path: #{value.inspect}" unless path.absolute?

    path.cleanpath
  end

  def ensure_not_symlink(path, label)
    raise Error, "#{label} must not be a symbolic link: #{path}" if path.symlink?
  end

  def mkdir_secure(path)
    path.mkpath
    File.chmod(0o700, path.to_s)
  end

  def mkdir_secure_tree(root, segments)
    current = Pathname.new(root)
    Array(segments).each do |segment|
      segment = segment.to_s
      unless !segment.empty? && segment != "." && segment != ".." && File.basename(segment) == segment
        raise Error, "unsafe runtime directory segment: #{segment.inspect}"
      end
      current = current.join(segment)
      if current.exist?
        raise Error, "runtime directory component must not be a symbolic link: #{current}" if current.symlink?
        raise Error, "runtime directory component is not a directory: #{current}" unless current.directory?
      else
        Dir.mkdir(current.to_s, 0o700)
      end
      File.chmod(0o700, current.to_s)
    end
    current
  end

  def canonical_existing_directory(path, label)
    raise Error, "#{label} is not an existing directory: #{path}" unless path.directory?
    ensure_not_symlink(path, label)
    path.realpath
  rescue Errno::EACCES => e
    raise Error, "#{label} is not accessible: #{path} (#{e.message})"
  end

  def canonical_existing_file(path, label)
    raise Error, "#{label} is not an existing file: #{path}" unless path.file?
    ensure_not_symlink(path, label)
    path.realpath
  rescue Errno::EACCES => e
    raise Error, "#{label} is not accessible: #{path} (#{e.message})"
  end

  def default_policy_path
    repo_root.join("agent-runtime-policy.yaml")
  end

  def load_policy(path_value = nil)
    path = path_value ? absolute_path(path_value, "policy path") : default_policy_path
    path = canonical_existing_file(path, "runtime policy")
    overlay = load_yaml(path, "runtime policy")
    policy = deep_merge(DEFAULT_POLICY, overlay)
    validate_policy!(policy)
    { :data => policy, :path => path, :sha256 => sha256_file(path) }
  end

  def dotenv_value(raw_value)
    value = raw_value.to_s.strip
    quoted = value.match(/\A(['"])(.*?)\1(?:\s+#.*)?\z/m)
    return quoted[2] if quoted

    value.sub(/\s+#.*\z/, "").strip
  end

  def load_runtime_dotenv(path)
    values = {}
    return values unless path.file?
    path.each_line do |line|
      stripped = line.sub(/\A\uFEFF/, "").strip
      next if stripped.empty? || stripped.start_with?("#")
      match = stripped.match(/\A(?:export\s+)?(AGENT_WORK_DIR|AGENT_MEMORY_FILE|AGENT_TARGET_ROOT)\s*=\s*(.*)\z/)
      values[match[1]] = dotenv_value(match[2]) if match
    end
    values
  end

  def resolve_runtime_value(options, option_key, env_key, dotenv, dotenv_path)
    option_value = options[option_key].to_s.strip
    return [option_value, "command line"] unless option_value.empty?
    env_value = ENV[env_key].to_s.strip
    return [env_value, "process environment"] unless env_value.empty?
    dotenv_value_found = dotenv[env_key].to_s.strip
    return [dotenv_value_found, dotenv_path.to_s] unless dotenv_value_found.empty?
    [nil, nil]
  end

  def validate_policy!(policy)
    raise Error, "runtime policy schema_version must be 1.0" unless policy["schema_version"].to_s == "1.0"
    TERMINAL_STATUSES.each do |status|
      requirement = policy.fetch("close_requirements", {})[status]
      raise Error, "runtime policy is missing close_requirements.#{status}" unless requirement.is_a?(Hash)
      %w[minimum_outputs minimum_evidence minimum_residual_work].each do |key|
        value = requirement[key]
        raise Error, "runtime policy #{status}.#{key} must be a non-negative integer" unless value.is_a?(Integer) && value >= 0
      end
      maximum = requirement["maximum_residual_work"]
      unless maximum.nil? || (maximum.is_a?(Integer) && maximum >= 0)
        raise Error, "runtime policy #{status}.maximum_residual_work must be null or a non-negative integer"
      end
    end
    retention = policy["retention"]
    raise Error, "runtime policy retention must be a mapping" unless retention.is_a?(Hash)
    %w[clear_terminal_tmp_after_days archive_terminal_runs_after_days delete_archives_after_days].each do |key|
      value = retention[key]
      next if value.nil? && key == "delete_archives_after_days"
      raise Error, "runtime policy retention.#{key} must be a non-negative integer" unless value.is_a?(Integer) && value >= 0
    end
  end

  def common_options(parser, options)
    parser.on("--role DIR", "Agent role directory") { |value| options[:role] = value }
    parser.on("--work-dir DIR", "Override AGENT_WORK_DIR") { |value| options[:work_dir] = value }
    parser.on("--memory-file FILE", "Override AGENT_MEMORY_FILE") { |value| options[:memory_file] = value }
    parser.on("--target-root DIR", "Optional formal target root (overrides AGENT_TARGET_ROOT)") { |value| options[:target_root] = value }
    parser.on("--policy FILE", "Runtime policy YAML") { |value| options[:policy] = value }
  end

  def parse_options!(argv, banner)
    options = {}
    parser = OptionParser.new
    parser.banner = banner
    yield parser, options
    parser.on("-h", "--help", "Show help") do
      puts parser
      exit 0
    end
    parser.parse!(argv)
    raise Error.new("unexpected arguments: #{argv.join(' ')}\n#{parser}", 2) unless argv.empty?
    [options, parser]
  rescue OptionParser::ParseError => e
    raise Error.new("#{e.message}\n#{parser}", 2)
  end

  def resolve_role(options)
    role_value = options[:role]
    raise Error.new("--role is required", 2) if role_value.to_s.strip.empty?

    role = Pathname.new(File.expand_path(role_value)).cleanpath
    canonical_existing_directory(role, "role directory")
  end

  def read_profile(role)
    path = role.join("agent-soul", "PROFILE.yaml")
    profile = load_yaml(path, "role profile")
    id = profile["id"].to_s
    raise Error, "role profile id is missing" if id.empty?
    standalone_root = role == repo_root
    unless standalone_root || id == role.basename.to_s
      raise Error, "role profile id #{id.inspect} does not match role directory #{role.basename}"
    end
    %w[schema_version version].each do |field|
      raise Error, "role profile #{field} is missing" if profile[field].to_s.strip.empty?
    end
    [path.realpath, profile]
  end

  def resolve_context(options, sentinel_mode = :require)
    role = resolve_role(options)
    profile_path, profile = read_profile(role)
    dotenv_path = role.join("env", ".env")
    dotenv = load_runtime_dotenv(dotenv_path)
    work_value, work_source = resolve_runtime_value(options, :work_dir, "AGENT_WORK_DIR", dotenv, dotenv_path)
    memory_value, memory_source = resolve_runtime_value(options, :memory_file, "AGENT_MEMORY_FILE", dotenv, dotenv_path)
    target_value, target_source = resolve_runtime_value(options, :target_root, "AGENT_TARGET_ROOT", dotenv, dotenv_path)
    work = absolute_path(work_value, "AGENT_WORK_DIR")
    memory = absolute_path(memory_value, "AGENT_MEMORY_FILE")
    work = canonical_existing_directory(work, "AGENT_WORK_DIR")
    memory = canonical_existing_file(memory, "AGENT_MEMORY_FILE")
    target = target_value.nil? ? nil : canonical_existing_directory(absolute_path(target_value, "AGENT_TARGET_ROOT"), "AGENT_TARGET_ROOT")
    expected_memory = canonical_existing_file(role.join("agent-soul", "MEMORY.md"), "canonical role memory")
    raise Error, "AGENT_MEMORY_FILE must point to this role's canonical memory: #{expected_memory}" unless memory == expected_memory
    raise Error, "AGENT_WORK_DIR is not writable: #{work}" unless work.writable?
    raise Error, "AGENT_TARGET_ROOT must not be the AGENT_WORK_DIR itself" if target == work

    loaded_policy = load_policy(options[:policy])
    context = {
      :role => role,
      :agent_id => profile["id"],
      :profile => profile,
      :profile_path => profile_path,
      :work_dir => work,
      :memory_file => memory,
      :target_root => target,
      :path_sources => { "work_dir" => work_source, "memory_file" => memory_source, "target_root" => target_source },
      :policy => loaded_policy[:data],
      :policy_path => loaded_policy[:path],
      :policy_sha256 => loaded_policy[:sha256]
    }
    if sentinel_mode == :create
      File.chmod(0o700, work.to_s)
    end
    ensure_sentinel!(context, sentinel_mode)
    context
  end

  def sentinel_data(context)
    {
      "schema_version" => "1.0",
      "agent_id" => context[:agent_id],
      "role_directory" => context[:role].realpath.to_s,
      "profile_file" => context[:profile_path].to_s,
      "memory_file" => context[:memory_file].to_s,
      "created_at" => iso8601(now_utc)
    }
  end

  def validate_sentinel_data!(sentinel, context)
    expected = sentinel_data(context)
    %w[schema_version agent_id role_directory profile_file memory_file].each do |key|
      next if sentinel[key].to_s == expected[key].to_s
      raise Error, "Workdir sentinel mismatch for #{key}: expected #{expected[key].inspect}, found #{sentinel[key].inspect}; roles must not share AGENT_WORK_DIR"
    end
  end

  def ensure_sentinel!(context, mode)
    path = context[:work_dir].join(SENTINEL_NAME)
    if path.exist?
      ensure_not_symlink(path, "Workdir sentinel")
      validate_sentinel_data!(load_yaml(path, "Workdir sentinel"), context)
      return path
    end
    return nil if mode == :optional
    raise Error, "Workdir sentinel is missing: #{path}; initialize the Workdir with start" unless mode == :create

    flags = File::WRONLY | File::CREAT | File::EXCL
    data = sentinel_data(context)
    begin
      File.open(path.to_s, flags, 0o600) do |file|
        file.write(YAML.dump(data))
        file.flush
        file.fsync
      end
    rescue Errno::EEXIST
      validate_sentinel_data!(load_yaml(path, "Workdir sentinel"), context)
    end
    path
  end

  def execution_contract(context)
    env_example = canonical_existing_file(context[:role].join("env", ".env.example"), "role env example")
    mcp = canonical_existing_file(context[:role].join("mcp", "mcp.json"), "role MCP config")
    skill_paths = Dir.glob(context[:role].join("*-skills", "**", "SKILL.md").to_s).sort.map { |path| Pathname.new(path).realpath }
    raise Error, "role has no SKILL.md entrypoints for execution contract" if skill_paths.empty?
    {
      "env_example" => { "file" => env_example.to_s, "sha256" => sha256_file(env_example) },
      "mcp" => { "file" => mcp.to_s, "sha256" => sha256_file(mcp) },
      "skills" => skill_paths.map { |path| { "file" => path.to_s, "sha256" => sha256_file(path) } },
      "runtime_sources" => context[:path_sources]
    }
  end

  def default_run_id(goal, time)
    slug = goal.to_s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")[0, 32]
    slug = "task" if slug.empty?
    "#{time.strftime('%Y%m%dT%H%M%SZ')}-#{slug}-#{SecureRandom.hex(3)}"
  end

  def validate_run_id!(run_id)
    raise Error, "run-id must match #{RUN_ID_PATTERN.inspect}: #{run_id.inspect}" unless RUN_ID_PATTERN.match?(run_id.to_s)
  end

  def run_record(context, run_id, goal, tool, time)
    {
      "schema_version" => SCHEMA_VERSION,
      "agent_id" => context[:agent_id],
      "run_id" => run_id,
      "goal" => goal,
      "tool" => tool,
      "started_at" => iso8601(time),
      "finished_at" => nil,
      "status" => "active",
      "profile" => {
        "file" => context[:profile_path].to_s,
        "schema_version" => context[:profile]["schema_version"].to_s,
        "version" => context[:profile]["version"].to_s,
        "sha256" => sha256_file(context[:profile_path])
      },
      "execution_contract" => execution_contract(context),
      "memory" => {
        "file" => context[:memory_file].to_s,
        "read_at" => iso8601(time),
        "read_sha256" => sha256_file(context[:memory_file])
      },
      "target" => context[:target_root] && {
        "root" => context[:target_root].to_s,
        "source" => context[:path_sources]["target_root"],
        "kind" => "directory"
      },
      "inputs" => [],
      "outputs" => [],
      "evidence" => [],
      "approvals" => [],
      "commands" => [],
      "residual_work" => [],
      "memory_update" => {
        "status" => "pending",
        "proposal_file" => PROPOSAL_FILE_NAME,
        "entries" => [],
        "promoted_at" => nil
      },
      "retention" => {
        "policy_file" => context[:policy_path].to_s,
        "policy_sha256" => context[:policy_sha256],
        "close_requirements" => deep_copy(context[:policy]["close_requirements"]),
        "retention_rules" => deep_copy(context[:policy]["retention"]),
        "closed_at" => nil,
        "archived_at" => nil
      }
    }
  end

  def command_start(argv)
    options, parser = parse_options!(argv, "Usage: agent-runtime.rb start --role DIR --goal TEXT --tool TEXT [options]") do |opt, values|
      common_options(opt, values)
      opt.on("--goal TEXT", "Task goal") { |value| values[:goal] = value }
      opt.on("--tool TEXT", "Executing tool/runtime") { |value| values[:tool] = value }
      opt.on("--run-id ID", "Explicit safe run id") { |value| values[:run_id] = value }
    end
    raise Error.new("--goal is required\n#{parser}", 2) if options[:goal].to_s.strip.empty?
    raise Error.new("--tool is required\n#{parser}", 2) if options[:tool].to_s.strip.empty?
    reject_secrets!("run start", "goal" => options[:goal], "tool" => options[:tool])
    context = resolve_context(options, :create)
    time = now_utc
    run_id = options[:run_id] || default_run_id(options[:goal], time)
    validate_run_id!(run_id)
    date_path = time.strftime("%Y/%m/%d")
    %w[runs shared archive .locks].each { |name| mkdir_secure_tree(context[:work_dir], [name]) }
    parent = mkdir_secure_tree(context[:work_dir], ["runs"] + date_path.split("/"))
    run_dir = parent.join(run_id)
    begin
      Dir.mkdir(run_dir.to_s, 0o700)
    rescue Errno::EEXIST
      raise Error, "run directory already exists: #{run_dir}"
    end
    RUN_SUBDIRECTORIES.each { |name| Dir.mkdir(run_dir.join(name).to_s, 0o700) }
    record = run_record(context, run_id, options[:goal], options[:tool], time)
    atomic_yaml_write(run_dir.join(RUN_FILE_NAME), record)
    puts "STARTED: #{run_dir}"
    puts "SOURCES: AGENT_WORK_DIR=#{context[:path_sources]['work_dir']}, AGENT_MEMORY_FILE=#{context[:path_sources]['memory_file']}, AGENT_TARGET_ROOT=#{context[:path_sources]['target_root'] || 'unset'}"
  rescue StandardError
    if defined?(run_dir) && run_dir && run_dir.directory? && !run_dir.join(RUN_FILE_NAME).exist?
      FileUtils.rm_rf(run_dir.to_s)
    end
    raise
  end

  def path_within?(path, root)
    path_string = path.cleanpath.to_s
    root_string = root.cleanpath.to_s
    path_string == root_string || path_string.start_with?(root_string + File::SEPARATOR)
  end

  def safe_relative_components!(path, root, label)
    path = Pathname.new(path).cleanpath
    root = Pathname.new(root).cleanpath
    raise Error, "#{label} escapes allowed root #{root}: #{path}" unless path_within?(path, root)

    components = path.relative_path_from(root).each_filename.to_a
    if components.any? { |segment| segment.empty? || segment == "." || segment == ".." || File.basename(segment) != segment }
      raise Error, "#{label} contains an unsafe path component: #{path}"
    end
    components
  end

  # Resolve an existing file or directory without accepting a symlink at any
  # component between an allowed root and the target. Call this again directly
  # before destructive writes to narrow path-swap races.
  def canonical_existing_entry_within!(path, roots, label, directory:)
    lexical = Pathname.new(path).cleanpath
    allowed_roots = Array(roots).map { |root| Pathname.new(root).cleanpath }
    root = allowed_roots.find { |candidate| path_within?(lexical, candidate) }
    raise Error, "#{label} escapes its allowed roots: #{lexical}" unless root

    components = safe_relative_components!(lexical, root, label)
    root_stat = File.lstat(root.to_s)
    raise Error, "#{label} root must not be a symbolic link: #{root}" if root_stat.symlink?
    raise Error, "#{label} root is not a directory: #{root}" unless root_stat.directory?
    canonical_root = root.realpath
    raise Error, "#{label} root changed identity: #{root}" unless canonical_root == root

    current = root
    components.each_with_index do |segment, index|
      current = current.join(segment)
      stat = File.lstat(current.to_s)
      raise Error, "#{label} must not traverse a symbolic link: #{current}" if stat.symlink?
      is_target = index == components.length - 1
      if !is_target || directory
        raise Error, "#{label} component is not a directory: #{current}" unless stat.directory?
      else
        raise Error, "#{label} is not a regular file: #{current}" unless stat.file?
      end
    end

    resolved = lexical.realpath
    raise Error, "#{label} resolves outside #{canonical_root}: #{lexical}" unless path_within?(resolved, canonical_root)
    [resolved, canonical_root, components]
  rescue Errno::ENOENT
    raise Error, "#{label} does not exist: #{lexical}"
  rescue Errno::EACCES => e
    raise Error, "#{label} is not accessible: #{lexical} (#{e.message})"
  end

  def secure_run_subdirectory!(run_dir, name)
    expected = Pathname.new(run_dir).join(name).cleanpath
    resolved, = canonical_existing_entry_within!(expected, [run_dir], "run #{name}/ directory", :directory => true)
    raise Error, "run #{name}/ directory changed identity: #{expected}" unless resolved == expected
    resolved
  end

  def resolve_run_dir(context, run_value)
    raise Error.new("--run is required", 2) if run_value.to_s.strip.empty?
    supplied = Pathname.new(run_value.to_s)
    supplied = Pathname.new(File.expand_path(supplied.to_s)) unless supplied.absolute?
    supplied = supplied.dirname if supplied.basename.to_s == RUN_FILE_NAME
    supplied = canonical_existing_directory(supplied.cleanpath, "run directory")
    runs = context[:work_dir].join("runs").cleanpath
    archive = context[:work_dir].join("archive").cleanpath
    unless path_within?(supplied, runs) || path_within?(supplied, archive)
      raise Error, "run directory escapes this role's Workdir runs/archive roots: #{supplied}"
    end
    supplied
  end

  def run_yaml_path(run_dir)
    run_dir.join(RUN_FILE_NAME)
  end

  def load_run(run_dir)
    load_yaml(run_yaml_path(run_dir), "run record")
  end

  def relative_artifact_path(run_dir, value, expected_prefix)
    supplied = Pathname.new(value.to_s)
    absolute = supplied.absolute? ? supplied.cleanpath : run_dir.join(supplied).cleanpath
    raise Error, "artifact path escapes run directory: #{value}" unless path_within?(absolute, run_dir)
    relative = absolute.relative_path_from(run_dir).to_s
    unless relative == expected_prefix || relative.start_with?(expected_prefix + File::SEPARATOR)
      raise Error, "artifact #{value.inspect} must be under #{expected_prefix}/"
    end
    raise Error, "artifact does not exist: #{absolute}" unless absolute.exist?
    raise Error, "artifact must not be a symbolic link: #{absolute}" if absolute.symlink?
    raise Error, "artifact must be a regular file: #{absolute}" unless absolute.file?
    resolved = absolute.realpath
    raise Error, "artifact resolves outside run directory: #{absolute}" unless path_within?(resolved, run_dir)
    [relative, resolved]
  end

  def artifact_record(run_dir, value, expected_prefix, time)
    relative, resolved = relative_artifact_path(run_dir, value, expected_prefix)
    {
      "path" => relative,
      "sha256" => sha256_file(resolved),
      "size_bytes" => resolved.size,
      "recorded_at" => iso8601(time)
    }
  end

  def replace_artifact_record(record, collection, artifact)
    record[collection].reject! { |item| item.is_a?(Hash) && item["path"] == artifact["path"] }
    record[collection] << artifact
  end

  def post_promotion_command(record, run_dir, label, argv)
    started = now_utc
    stdout, stderr, status = Open3.capture3(*argv, :chdir => repo_root.to_s)
    relative_log = "evidence/memory-promotion-#{label}.log"
    log_path = run_dir.join(relative_log)
    log = <<~LOG
      command: #{JSON.generate(argv)}
      cwd: #{repo_root}
      executed_at: #{iso8601(started)}
      exit_code: #{status.exitstatus}

      [stdout]
      #{stdout}
      [stderr]
      #{stderr}
    LOG
    atomic_write(log_path, log, 0o600)
    command = {
      "command" => JSON.generate(argv),
      "executed_at" => iso8601(started),
      "exit_code" => status.exitstatus,
      "cwd" => repo_root.to_s,
      "evidence" => relative_log,
      "stdout_sha256" => Digest::SHA256.hexdigest(stdout),
      "stderr_sha256" => Digest::SHA256.hexdigest(stderr)
    }
    record["commands"] << command
    replace_artifact_record(record, "evidence", artifact_record(run_dir, relative_log, "evidence", now_utc))
    [status.success?, command]
  end

  def run_post_promotion_checks(record, context, run_dir)
    renderer = Pathname.new(__dir__).join("render-agent-detail-en.rb").expand_path
    validator = Pathname.new(__dir__).join("validate-role.rb").expand_path
    render_ok, render_command = post_promotion_command(
      record, run_dir, "render", [RbConfig.ruby, renderer.to_s, context[:role].to_s]
    )
    validate_ok, validate_command = post_promotion_command(
      record, run_dir, "validate", [RbConfig.ruby, validator.to_s, context[:role].to_s, "--phase", "standalone"]
    )
    checked_at = iso8601(now_utc)
    result = {
      "status" => render_ok && validate_ok ? "pass" : "failed",
      "checked_at" => checked_at,
      "render_exit_code" => render_command["exit_code"],
      "validate_exit_code" => validate_command["exit_code"]
    }
    [render_ok && validate_ok, result]
  end

  def parse_json_object(value, label)
    parsed = JSON.parse(value)
    raise Error, "#{label} must be a JSON object" unless parsed.is_a?(Hash)
    stringify_keys(parsed)
  rescue JSON::ParserError => e
    raise Error, "#{label} is invalid JSON: #{e.message}"
  end

  def checkpoint_options(opt, values)
    opt.on("--run RUN", "Run directory or run.yaml") { |value| values[:run] = value }
    opt.on("--input PATH", "Record input file (repeatable)") { |value| (values[:inputs] ||= []) << value }
    opt.on("--output PATH", "Record output file (repeatable)") { |value| (values[:outputs] ||= []) << value }
    opt.on("--evidence PATH", "Record evidence file (repeatable)") { |value| (values[:evidence] ||= []) << value }
    opt.on("--residual-work TEXT", "Record residual work (repeatable)") { |value| (values[:residual] ||= []) << value }
    opt.on("--approval JSON", "Append structured approval (repeatable)") { |value| (values[:approvals] ||= []) << value }
    opt.on("--command JSON", "Append structured command record (repeatable)") { |value| (values[:commands] ||= []) << value }
  end

  def append_checkpoint_fields!(record, run_dir, options, time)
    { :inputs => ["inputs", "input"], :outputs => ["outputs", "output"], :evidence => ["evidence", "evidence"] }.each do |option_key, pair|
      (options[option_key] || []).each do |path|
        replace_artifact_record(record, pair[0], artifact_record(run_dir, path, pair[1], time))
      end
    end
    (options[:residual] || []).each do |description|
      raise Error, "residual work must not be empty" if description.to_s.strip.empty?
      reject_secrets!("run checkpoint", "residual_work" => description)
      record["residual_work"] << { "description" => description, "recorded_at" => iso8601(time) }
    end
    (options[:approvals] || []).each do |json|
      approval = parse_json_object(json, "approval")
      reject_secrets!("run checkpoint", "approval" => JSON.generate(approval))
      record["approvals"] << approval
    end
    (options[:commands] || []).each do |json|
      command = parse_json_object(json, "command")
      reject_secrets!("run checkpoint", "command" => JSON.generate(command))
      record["commands"] << command
    end
  end

  def checkpoint_present?(options)
    %i[inputs outputs evidence residual approvals commands].any? { |key| options[key].is_a?(Array) && !options[key].empty? }
  end

  def command_record(argv)
    options, parser = parse_options!(argv, "Usage: agent-runtime.rb record --role DIR --run RUN [checkpoint options]") do |opt, values|
      common_options(opt, values)
      checkpoint_options(opt, values)
    end
    raise Error.new("record requires at least one input, output, evidence, residual-work, approval, or command\n#{parser}", 2) unless checkpoint_present?(options)
    context = resolve_context(options)
    run_dir = resolve_run_dir(context, options[:run])
    record = load_run(run_dir)
    raise Error, "only active runs can accept checkpoints; found #{record['status'].inspect}" unless record["status"] == "active"
    append_checkpoint_fields!(record, run_dir, options, now_utc)
    validate_record!(record, context, run_dir, false)
    atomic_yaml_write(run_yaml_path(run_dir), record)
    puts "RECORDED: #{run_dir}"
  end

  def command_close(argv)
    options, parser = parse_options!(argv, "Usage: agent-runtime.rb close --role DIR --run RUN --status STATUS [options]") do |opt, values|
      common_options(opt, values)
      checkpoint_options(opt, values)
      opt.on("--status STATUS", "Terminal status") { |value| values[:status] = value }
    end
    status = options[:status].to_s
    raise Error.new("--status must be one of #{TERMINAL_STATUSES.join(', ')}\n#{parser}", 2) unless TERMINAL_STATUSES.include?(status)
    context = resolve_context(options)
    run_dir = resolve_run_dir(context, options[:run])
    record = load_run(run_dir)
    if TERMINAL_STATUSES.include?(record["status"])
      if record["status"] == status
        validate_record!(record, context, run_dir, true)
        puts "ALREADY CLOSED: #{run_dir} (#{status})"
        return
      end
      raise Error, "run is already terminal with status #{record['status']}; terminal history is immutable"
    end
    raise Error, "only active runs can be closed; found #{record['status'].inspect}" unless record["status"] == "active"

    time = now_utc
    append_checkpoint_fields!(record, run_dir, options, time)
    memory_update = record["memory_update"]
    if memory_update["status"] == "pending"
      proposal_path = run_dir.join(memory_update["proposal_file"].to_s)
      memory_update["status"] = proposal_path.file? ? "proposal-only" : "none"
    end
    record["status"] = status
    record["finished_at"] = iso8601(time)
    record["retention"]["closed_at"] = record["finished_at"]
    validate_record!(record, context, run_dir, true)
    atomic_yaml_write(run_yaml_path(run_dir), record)
    puts "CLOSED: #{run_dir} (#{status})"
  end

  def add_error(errors, condition, message)
    errors << message unless condition
  end

  def artifact_errors(entries, label, prefix, run_dir, errors)
    unless entries.is_a?(Array)
      errors << "#{label} must be an array"
      return
    end
    entries.each_with_index do |entry, index|
      unless entry.is_a?(Hash)
        errors << "#{label}[#{index}] must be a mapping"
        next
      end
      path = entry["path"]
      unless path.is_a?(String) && !path.empty?
        errors << "#{label}[#{index}].path must be a non-empty string"
        next
      end
      begin
        relative, resolved = relative_artifact_path(run_dir, path, prefix)
        errors << "#{label}[#{index}].path must be normalized as #{relative.inspect}" unless path == relative
        actual_hash = sha256_file(resolved)
        errors << "#{label}[#{index}].sha256 does not match current file" unless entry["sha256"] == actual_hash
        errors << "#{label}[#{index}].size_bytes does not match current file" unless entry["size_bytes"] == resolved.size
        parse_iso8601(entry["recorded_at"], "#{label}[#{index}].recorded_at")
      rescue Error => e
        errors << e.message
      end
    end
  end

  def validate_record!(record, context, run_dir, enforce_close)
    errors = AgentWakerValidation.validate_against_schema(
      record,
      AgentWakerValidation::RUN_RECORD_SCHEMA_PATH
    ).map { |error| "run-record schema #{error}" }
    required = %w[schema_version agent_id run_id goal tool started_at finished_at status profile execution_contract memory inputs outputs evidence approvals commands residual_work memory_update retention]
    required.each { |field| errors << "missing required field: #{field}" unless record.key?(field) }
    add_error(errors, record["schema_version"].to_s == SCHEMA_VERSION, "schema_version must be #{SCHEMA_VERSION.inspect}")
    add_error(errors, record["agent_id"] == context[:agent_id], "agent_id must be #{context[:agent_id].inspect}")
    add_error(errors, RUN_ID_PATTERN.match?(record["run_id"].to_s), "run_id has an unsafe format")
    add_error(errors, record["run_id"].to_s == run_dir.basename.to_s, "run_id must match run directory basename")
    %w[goal tool].each { |field| add_error(errors, record[field].is_a?(String) && !record[field].strip.empty?, "#{field} must be a non-empty string") }
    begin
      started = parse_iso8601(record["started_at"], "started_at")
    rescue Error => e
      errors << e.message
      started = nil
    end
    status = record["status"]
    add_error(errors, RUN_STATUSES.include?(status), "status must be one of #{RUN_STATUSES.join(', ')}")
    if status == "active"
      add_error(errors, record["finished_at"].nil?, "active run finished_at must be null")
    elsif TERMINAL_STATUSES.include?(status)
      begin
        finished = parse_iso8601(record["finished_at"], "finished_at")
        errors << "finished_at must not precede started_at" if started && finished < started
      rescue Error => e
        errors << e.message
      end
    end

    profile = record["profile"]
    if profile.is_a?(Hash)
      %w[file schema_version version sha256].each { |field| errors << "profile.#{field} is required" if profile[field].to_s.empty? }
      errors << "profile.file must be the absolute canonical profile path" unless profile["file"] == context[:profile_path].to_s
      errors << "profile.sha256 must be lowercase SHA-256" unless SHA256_PATTERN.match?(profile["sha256"].to_s)
    else
      errors << "profile must be a mapping"
    end
    memory = record["memory"]
    if memory.is_a?(Hash)
      %w[file read_at read_sha256].each { |field| errors << "memory.#{field} is required" if memory[field].to_s.empty? }
      errors << "memory.file must be this role's canonical memory" unless memory["file"] == context[:memory_file].to_s
      errors << "memory.read_sha256 must be lowercase SHA-256" unless SHA256_PATTERN.match?(memory["read_sha256"].to_s)
      begin
        parse_iso8601(memory["read_at"], "memory.read_at")
      rescue Error => e
        errors << e.message
      end
    else
      errors << "memory must be a mapping"
    end

    artifact_errors(record["inputs"], "inputs", "input", run_dir, errors)
    artifact_errors(record["outputs"], "outputs", "output", run_dir, errors)
    artifact_errors(record["evidence"], "evidence", "evidence", run_dir, errors)
    %w[approvals commands residual_work].each do |field|
      unless record[field].is_a?(Array) && record[field].all? { |entry| entry.is_a?(Hash) }
        errors << "#{field} must be an array of mappings"
      end
    end
    if record["residual_work"].is_a?(Array)
      record["residual_work"].each_with_index do |entry, index|
        errors << "residual_work[#{index}].description must be non-empty" unless entry.is_a?(Hash) && entry["description"].is_a?(String) && !entry["description"].strip.empty?
      end
    end
    memory_update = record["memory_update"]
    if memory_update.is_a?(Hash)
      %w[status proposal_file entries promoted_at].each { |field| errors << "memory_update.#{field} is required" unless memory_update.key?(field) }
      errors << "memory_update.status is invalid" unless MEMORY_STATUSES.include?(memory_update["status"])
      errors << "memory_update.proposal_file must be #{PROPOSAL_FILE_NAME.inspect}" unless memory_update["proposal_file"] == PROPOSAL_FILE_NAME
      errors << "memory_update.entries must be an array" unless memory_update["entries"].is_a?(Array)
    else
      errors << "memory_update must be a mapping"
    end
    retention = record["retention"]
    unless retention.is_a?(Hash) && %w[policy_file policy_sha256 close_requirements retention_rules closed_at archived_at].all? { |field| retention.key?(field) }
      errors << "retention must contain policy_file, policy_sha256, close_requirements, retention_rules, closed_at, and archived_at"
    else
      if status == "active"
        errors << "active run retention.policy_file must match the selected policy" unless retention["policy_file"] == context[:policy_path].to_s
        errors << "active run retention.policy_sha256 must match the selected policy" unless retention["policy_sha256"] == context[:policy_sha256]
      end
    end

    permission_expectations = [[context[:work_dir], 0o700], [context[:work_dir].join(SENTINEL_NAME), 0o600], [run_dir, 0o700], [run_yaml_path(run_dir), 0o600]]
    RUN_SUBDIRECTORIES.each do |name|
      directory = run_dir.join(name)
      if directory.symlink?
        errors << "run subdirectory must not be a symbolic link: #{directory}"
      elsif !directory.directory?
        errors << "run subdirectory is missing or not a directory: #{directory}"
      else
        begin
          resolved = directory.realpath
          errors << "run subdirectory resolves outside run directory: #{directory}" unless path_within?(resolved, run_dir)
        rescue Errno::ENOENT, Errno::EACCES => e
          errors << "run subdirectory is not safely resolvable: #{directory} (#{e.message})"
        end
        permission_expectations << [directory, 0o700]
      end
    end
    proposal = run_dir.join(PROPOSAL_FILE_NAME)
    if proposal.symlink?
      errors << "memory proposal must not be a symbolic link: #{proposal}"
    elsif proposal.exist?
      errors << "memory proposal must be a regular file: #{proposal}" unless proposal.file?
      permission_expectations << [proposal, 0o600] if proposal.file?
    end
    lock = context[:work_dir].join(".locks", "memory.lock")
    locks_dir = context[:work_dir].join(".locks")
    if locks_dir.symlink?
      errors << "runtime locks directory must not be a symbolic link: #{locks_dir}"
    elsif locks_dir.exist?
      errors << "runtime locks path must be a directory: #{locks_dir}" unless locks_dir.directory?
      permission_expectations << [locks_dir, 0o700] if locks_dir.directory?
    end
    if lock.symlink?
      errors << "memory lock must not be a symbolic link: #{lock}"
    elsif lock.exist?
      errors << "memory lock must be a regular file: #{lock}" unless lock.file?
      permission_expectations << [lock, 0o600] if lock.file?
    end
    permission_expectations.each do |path, expected_mode|
      next unless path.exist?
      next if path.symlink?
      actual_mode = path.lstat.mode & 0o777
      errors << "permissions for #{path} must be #{format('%04o', expected_mode)}, found #{format('%04o', actual_mode)}" unless actual_mode == expected_mode
    end

    if enforce_close && TERMINAL_STATUSES.include?(status)
      requirement = record.dig("retention", "close_requirements", status)
      unless requirement.is_a?(Hash)
        errors << "retention.close_requirements is missing terminal status #{status}"
        requirement = { "minimum_outputs" => 0, "minimum_evidence" => 0, "minimum_residual_work" => 0 }
      end
      outputs_count = record["outputs"].is_a?(Array) ? record["outputs"].length : 0
      evidence_count = record["evidence"].is_a?(Array) ? record["evidence"].length : 0
      residual_count = record["residual_work"].is_a?(Array) ? record["residual_work"].length : 0
      errors << "#{status} requires at least #{requirement['minimum_outputs']} output(s)" if outputs_count < requirement["minimum_outputs"]
      errors << "#{status} requires at least #{requirement['minimum_evidence']} evidence item(s)" if evidence_count < requirement["minimum_evidence"]
      errors << "#{status} requires at least #{requirement['minimum_residual_work']} residual-work item(s)" if residual_count < requirement["minimum_residual_work"]
      maximum = requirement["maximum_residual_work"]
      errors << "#{status} permits at most #{maximum} residual-work item(s)" if maximum && residual_count > maximum
      errors << "terminal run must resolve memory_update.status" if memory_update.is_a?(Hash) && memory_update["status"] == "pending"
    end

    raise Error, "invalid run record #{run_yaml_path(run_dir)}:\n- #{errors.uniq.join("\n- ")}" unless errors.empty?
    true
  end

  def command_validate(argv)
    options, = parse_options!(argv, "Usage: agent-runtime.rb validate --role DIR --run RUN [options]") do |opt, values|
      common_options(opt, values)
      opt.on("--run RUN", "Run directory or run.yaml") { |value| values[:run] = value }
    end
    context = resolve_context(options)
    run_dir = resolve_run_dir(context, options[:run])
    record = load_run(run_dir)
    validate_record!(record, context, run_dir, TERMINAL_STATUSES.include?(record["status"]))
    puts "PASS: #{run_dir}"
  end

  def expected_run_dirs(work_dir)
    roots = []
    %w[runs archive].each do |root_name|
      root = work_dir.join(root_name)
      next unless root.exist? || root.symlink?
      raise Error, "Workdir #{root_name}/ root must not be a symbolic link: #{root}" if root.symlink?
      raise Error, "Workdir #{root_name}/ root is not a directory: #{root}" unless root.directory?
      raise Error, "Workdir #{root_name}/ root changed identity: #{root}" unless root.realpath == root.cleanpath

      Dir.glob(root.join("*", "*", "*", "*").to_s).sort.each do |path|
        candidate = Pathname.new(path).cleanpath
        resolved, = canonical_existing_entry_within!(candidate, [root], "run directory", :directory => true)
        raise Error, "run directory changed identity: #{candidate}" unless resolved == candidate
        roots << resolved
      end
    end
    roots
  end

  def command_validate_all(argv)
    options, = parse_options!(argv, "Usage: agent-runtime.rb validate-all --role DIR [options]") { |opt, values| common_options(opt, values) }
    context = resolve_context(options)
    errors = []
    run_dirs = expected_run_dirs(context[:work_dir])
    run_dirs.each do |run_dir|
      begin
        record = load_run(run_dir)
        validate_record!(record, context, run_dir.realpath, TERMINAL_STATUSES.include?(record["status"]))
        puts "PASS: #{run_dir}"
      rescue Error => e
        errors << e.message
      end
    end
    unless errors.empty?
      raise Error, "validate-all found #{errors.length} invalid run(s):\n#{errors.map { |error| "- #{error}" }.join("\n")}"
    end
    puts "PASS: #{context[:agent_id]} #{run_dirs.length} run record(s)"
  end

  def proposal_front_matter(path)
    raise Error, "memory proposal must not be a symbolic link: #{path}" if path.symlink?
    flags = File::RDONLY | (File.const_defined?(:NOFOLLOW) ? File::NOFOLLOW : 0)
    text = File.open(path.to_s, flags) { |file| file.read.encode("UTF-8") }
    match = text.match(/\A---\s*\n(.*?)\n---\s*\n/m)
    raise Error, "memory proposal is missing YAML front matter: #{path}" unless match
    safe_yaml_load(match[1], "memory proposal front matter")
  rescue Errno::EACCES, Errno::ELOOP => e
    raise Error, "memory proposal is not readable: #{path} (#{e.message})"
  end

  def next_memory_id(memory_text, proposal_text, date)
    prefix = "MEM-#{date.strftime('%Y%m%d')}-"
    ids = (memory_text.to_s + "\n" + proposal_text.to_s).scan(/\b#{Regexp.escape(prefix)}(\d{3})\b/).flatten.map(&:to_i)
    number = ids.empty? ? 1 : ids.max + 1
    raise Error, "daily memory id space exhausted for #{date}" if number > 999
    format("%s%03d", prefix, number)
  end

  def render_memory_entry(entry)
    <<~MARKDOWN.rstrip
      ### #{entry['id']} — #{entry['title']}

      - **Type:** #{entry['type']}
      - **Scope:** #{entry['scope']}
      - **Memory:** #{entry['memory']}
      - **Evidence:** #{entry['evidence']}
      - **Verified at:** #{entry['verified_at']}
      - **Reuse when:** #{entry['reuse_when']}
      - **Supersedes:** #{entry['supersedes']}
    MARKDOWN
  end

  def reject_secrets!(surface, fields)
    fields.each do |label, value|
      AgentWakerValidation::SECRET_PATTERNS.each do |secret_label, pattern|
        if value.to_s.match?(pattern)
          raise Error, "#{surface} #{label} contains possible #{secret_label}; credentials and secrets are forbidden"
        end
      end
    end
  end

  def validate_memory_entries!(entries, context, run_dir, record)
    raise Error, "memory proposal entries must be a non-empty array" unless entries.is_a?(Array) && !entries.empty?
    seen_ids = {}
    recorded_evidence = Array(record["evidence"]).map { |item| item["path"] if item.is_a?(Hash) }.compact

    entries.each_with_index do |entry, index|
      raise Error, "memory proposal entry #{index} must be a mapping" unless entry.is_a?(Hash)
      missing = MEMORY_ENTRY_KEYS - entry.keys
      unknown = entry.keys - MEMORY_ENTRY_KEYS
      raise Error, "memory proposal entry #{index} is missing #{missing.join(', ')}" unless missing.empty?
      raise Error, "memory proposal entry #{index} has unsupported fields: #{unknown.join(', ')}" unless unknown.empty?

      MEMORY_ENTRY_KEYS.each do |key|
        value = entry[key]
        raise Error, "memory proposal entry #{index}.#{key} must be a non-empty string" unless value.is_a?(String) && !value.strip.empty?
        if value.include?("\n") || value.include?("\r") || value.include?("\0")
          raise Error, "memory proposal entry #{index}.#{key} must be a single safe line"
        end
        if value.include?(LEARNED_BEGIN) || value.include?(LEARNED_END)
          raise Error, "memory proposal entry #{index}.#{key} contains a reserved Learned Memory marker"
        end
      end

      id = entry["id"]
      raise Error, "memory proposal entry #{index}.id is invalid" unless MEMORY_ID_PATTERN.match?(id)
      raise Error, "memory proposal contains duplicate id #{id}" if seen_ids[id]
      seen_ids[id] = true
      raise Error, "memory proposal entry #{id} has an invalid type" unless MEMORY_TYPES.include?(entry["type"])
      raise Error, "memory proposal entry #{id} has an invalid scope" unless MEMORY_SCOPES.include?(entry["scope"])
      unless entry["supersedes"] == "none" || MEMORY_ID_PATTERN.match?(entry["supersedes"])
        raise Error, "memory proposal entry #{id}.supersedes must be none or a Memory id"
      end
      begin
        verified = Date.iso8601(entry["verified_at"])
      rescue ArgumentError
        raise Error, "memory proposal entry #{id}.verified_at must be YYYY-MM-DD"
      end
      raise Error, "memory proposal entry #{id} date must match verified_at" unless id.start_with?("MEM-#{verified.strftime('%Y%m%d')}-")

      reject_secrets!("memory proposal entry #{id}", entry)
      evidence_relative, = relative_artifact_path(run_dir, entry["evidence"], "evidence")
      unless recorded_evidence.include?(evidence_relative)
        raise Error, "memory proposal entry #{id} evidence is not recorded in run.yaml: #{evidence_relative}"
      end
    end

    true
  end

  def validate_memory_proposal!(proposal, context, run_dir, record)
    raise Error, "memory proposal schema_version must be 1.0" unless proposal["schema_version"] == "1.0"
    raise Error, "memory proposal agent_id mismatch" unless proposal["agent_id"] == context[:agent_id]
    raise Error, "memory proposal run_id mismatch" unless proposal["run_id"] == record["run_id"]
    raise Error, "memory proposal memory_file mismatch" unless proposal["memory_file"] == context[:memory_file].to_s
    raise Error, "memory proposal base hash does not match run record" unless proposal["memory_read_sha256"] == record.dig("memory", "read_sha256")
    parse_iso8601(proposal["created_at"], "memory proposal created_at")
    validate_memory_entries!(proposal["entries"], context, run_dir, record)
  end

  def write_proposal(path, proposal)
    body = proposal["entries"].map { |entry| render_memory_entry(entry) }.join("\n\n")
    content = YAML.dump(proposal) + "---\n\n# Memory Update Proposal\n\n#{body}\n"
    atomic_write(path, content, 0o600)
  end

  def command_propose_memory(argv)
    options, parser = parse_options!(argv, "Usage: agent-runtime.rb propose-memory --role DIR --run RUN [entry options]") do |opt, values|
      common_options(opt, values)
      opt.on("--run RUN") { |value| values[:run] = value }
      opt.on("--title TEXT") { |value| values[:title] = value }
      opt.on("--type TYPE") { |value| values[:type] = value }
      opt.on("--scope SCOPE") { |value| values[:scope] = value }
      opt.on("--memory TEXT") { |value| values[:memory] = value }
      opt.on("--evidence REF") { |value| values[:evidence] = value }
      opt.on("--verified-at DATE") { |value| values[:verified_at] = value }
      opt.on("--reuse-when TEXT") { |value| values[:reuse_when] = value }
      opt.on("--supersedes ID") { |value| values[:supersedes] = value }
    end
    %i[title type scope memory evidence reuse_when].each do |key|
      raise Error.new("--#{key.to_s.tr('_', '-')} is required\n#{parser}", 2) if options[key].to_s.strip.empty?
    end
    raise Error, "--type must be one of #{MEMORY_TYPES.join(', ')}" unless MEMORY_TYPES.include?(options[:type])
    raise Error, "--scope must be one of #{MEMORY_SCOPES.join(', ')}" unless MEMORY_SCOPES.include?(options[:scope])
    reject_secrets!("memory proposal",
      "title" => options[:title],
      "memory" => options[:memory],
      "evidence" => options[:evidence],
      "reuse_when" => options[:reuse_when],
      "supersedes" => options[:supersedes]
    )
    verified_at = options[:verified_at] || Date.today.iso8601
    Date.iso8601(verified_at)
    context = resolve_context(options)
    run_dir = resolve_run_dir(context, options[:run])
    record = load_run(run_dir)
    validate_record!(record, context, run_dir, TERMINAL_STATUSES.include?(record["status"]))
    raise Error, "cannot add a proposal after Memory was promoted" if record["memory_update"]["status"] == "promoted"
    evidence_relative, = relative_artifact_path(run_dir, options[:evidence], "evidence")
    replace_artifact_record(record, "evidence", artifact_record(run_dir, evidence_relative, "evidence", now_utc))
    proposal_path = run_dir.join(PROPOSAL_FILE_NAME)
    raise Error, "memory proposal must not be a symbolic link: #{proposal_path}" if proposal_path.symlink?
    existing = proposal_path.file? ? proposal_front_matter(proposal_path) : nil
    if existing
      raise Error, "proposal run_id mismatch" unless existing["run_id"] == record["run_id"]
      raise Error, "proposal base hash mismatch" unless existing["memory_read_sha256"] == record["memory"]["read_sha256"]
      proposal = existing
      proposal_text = proposal_path.read(encoding: "UTF-8")
    else
      proposal = {
        "schema_version" => "1.0",
        "agent_id" => context[:agent_id],
        "run_id" => record["run_id"],
        "memory_file" => context[:memory_file].to_s,
        "memory_read_sha256" => record["memory"]["read_sha256"],
        "created_at" => iso8601(now_utc),
        "entries" => []
      }
      proposal_text = ""
    end
    id = next_memory_id(context[:memory_file].read(encoding: "UTF-8"), proposal_text, Date.parse(verified_at))
    entry = {
      "id" => id,
      "title" => options[:title],
      "type" => options[:type],
      "scope" => options[:scope],
      "memory" => options[:memory],
      "evidence" => evidence_relative,
      "verified_at" => verified_at,
      "reuse_when" => options[:reuse_when],
      "supersedes" => options[:supersedes] || "none"
    }
    proposal["entries"] << entry
    record["memory_update"]["status"] = "proposal-only"
    record["memory_update"]["entries"] = proposal["entries"].map { |item| item["id"] }
    validate_memory_proposal!(proposal, context, run_dir, record)
    validate_record!(record, context, run_dir, TERMINAL_STATUSES.include?(record["status"]))
    write_proposal(proposal_path, proposal)
    atomic_yaml_write(run_yaml_path(run_dir), record)
    puts "PROPOSED: #{id} in #{proposal_path}"
  rescue ArgumentError
    raise Error, "--verified-at must be YYYY-MM-DD"
  end

  def proposal_conflict!(record, run_dir, proposal_path, message, current_hash)
    time = now_utc
    conflict_name = "memory-update-conflict-#{time.strftime('%Y%m%dT%H%M%SZ')}-#{SecureRandom.hex(3)}.md"
    conflict_path = run_dir.join(conflict_name)
    raise Error, "memory proposal must not be a symbolic link: #{proposal_path}" if proposal_path.symlink?
    flags = File::RDONLY | (File.const_defined?(:NOFOLLOW) ? File::NOFOLLOW : 0)
    proposal_text = File.open(proposal_path.to_s, flags) { |file| file.read.encode("UTF-8") }
    content = "<!-- Conflict: #{message.gsub('--', '—')} -->\n" + proposal_text
    atomic_write(conflict_path, content, 0o600)
    update = record["memory_update"]
    update["status"] = "conflict"
    update["conflict_file"] = conflict_name
    update["conflict_detected_at"] = iso8601(time)
    update["current_memory_sha256"] = current_hash
    update["error"] = message
    atomic_yaml_write(run_yaml_path(run_dir), record)
    raise Error, "Memory promotion conflict; canonical Memory was not overwritten and proposal was retained at #{conflict_path}: #{message}"
  end

  def insert_memory_entries(memory_text, entries)
    raise Error, "canonical Memory must contain exactly one Learned Memory begin marker" unless memory_text.scan(LEARNED_BEGIN).length == 1
    raise Error, "canonical Memory must contain exactly one Learned Memory end marker" unless memory_text.scan(LEARNED_END).length == 1
    begin_index = memory_text.index(LEARNED_BEGIN)
    end_index = memory_text.index(LEARNED_END)
    raise Error, "Learned Memory markers are out of order" unless begin_index < end_index
    rendered = entries.map { |entry| render_memory_entry(entry) }
    existing = rendered.select { |entry| memory_text.include?(entry) }
    return memory_text if existing.length == rendered.length
    raise Error, "one or more proposed Memory IDs already exist with different content" if entries.any? { |entry| memory_text.match?(/^### #{Regexp.escape(entry['id'])}\b/) }

    insertion = rendered.join("\n\n") + "\n\n"
    merged = memory_text.sub(LEARNED_END, insertion + LEARNED_END)
    raise Error, "merged Memory must contain exactly one Learned Memory begin marker" unless merged.scan(LEARNED_BEGIN).length == 1
    raise Error, "merged Memory must contain exactly one Learned Memory end marker" unless merged.scan(LEARNED_END).length == 1
    raise Error, "merged Memory markers are out of order" unless merged.index(LEARNED_BEGIN) < merged.index(LEARNED_END)
    merged
  end

  def command_promote_memory(argv)
    options, = parse_options!(argv, "Usage: agent-runtime.rb promote-memory --role DIR --run RUN [options]") do |opt, values|
      common_options(opt, values)
      opt.on("--run RUN") { |value| values[:run] = value }
    end
    context = resolve_context(options)
    run_dir = resolve_run_dir(context, options[:run])
    record = load_run(run_dir)
    validate_record!(record, context, run_dir, TERMINAL_STATUSES.include?(record["status"]))
    proposal_path = run_dir.join(PROPOSAL_FILE_NAME)
    raise Error, "memory proposal must not be a symbolic link: #{proposal_path}" if proposal_path.symlink?
    raise Error, "memory proposal does not exist: #{proposal_path}" unless proposal_path.file?
    proposal = proposal_front_matter(proposal_path)
    expected_hash = record["memory"]["read_sha256"]
    validate_memory_proposal!(proposal, context, run_dir, record)

    locks = mkdir_secure_tree(context[:work_dir], [".locks"])
    lock_path = locks.join("memory.lock")
    raise Error, "memory lock must not be a symbolic link: #{lock_path}" if lock_path.symlink?
    lock_flags = File::RDWR | File::CREAT | (File.const_defined?(:NOFOLLOW) ? File::NOFOLLOW : 0)
    File.open(lock_path.to_s, lock_flags, 0o600) do |lock|
      lock.flock(File::LOCK_EX)
      File.chmod(0o600, lock_path.to_s)
      validate_memory_proposal!(proposal, context, run_dir, record)
      current_text = context[:memory_file].read(encoding: "UTF-8")
      current_hash = Digest::SHA256.hexdigest(current_text)
      begin
        merged = insert_memory_entries(current_text, proposal["entries"])
        reject_secrets!("merged Memory", "content" => merged)
      rescue Error => e
        proposal_conflict!(record, run_dir, proposal_path, e.message, current_hash)
      end
      already_present = merged == current_text && proposal["entries"].all? { |entry| current_text.include?(render_memory_entry(entry)) }
      if current_hash != expected_hash && !already_present
        proposal_conflict!(record, run_dir, proposal_path, "startup hash #{expected_hash} differs from current hash #{current_hash}", current_hash)
      end
      wrote_memory = false
      original_mode = context[:memory_file].lstat.mode & 0o777
      unless already_present
        atomic_write(context[:memory_file], merged, original_mode.zero? ? 0o600 : original_mode)
        wrote_memory = true
        current_hash = Digest::SHA256.hexdigest(merged)
      end
      update = record["memory_update"]
      update["entries"] = proposal["entries"].map { |entry| entry["id"] }
      post_ok, post_result = run_post_promotion_checks(record, context, run_dir)
      post_result["rolled_back"] = false
      unless post_ok
        if wrote_memory
          atomic_write(context[:memory_file], current_text, original_mode.zero? ? 0o600 : original_mode)
          renderer = Pathname.new(__dir__).join("render-agent-detail-en.rb").expand_path
          validator = Pathname.new(__dir__).join("validate-role.rb").expand_path
          _render_ok, rollback_render = post_promotion_command(
            record, run_dir, "rollback-render", [RbConfig.ruby, renderer.to_s, context[:role].to_s]
          )
          _validate_ok, rollback_validate = post_promotion_command(
            record, run_dir, "rollback-validate", [RbConfig.ruby, validator.to_s, context[:role].to_s, "--phase", "standalone"]
          )
          post_result["rolled_back"] = true
          post_result["rollback_render_exit_code"] = rollback_render["exit_code"]
          post_result["rollback_validate_exit_code"] = rollback_validate["exit_code"]
        end
        update["status"] = already_present ? "conflict" : "proposal-only"
        update["promoted_at"] = nil
        update.delete("base_sha256")
        update.delete("written_sha256")
        update["error"] = wrote_memory ? "post-promotion validation failed; canonical Memory was rolled back" : "post-promotion validation failed for entries already present in canonical Memory"
        update["post_promotion"] = post_result
        validate_record!(record, context, run_dir, TERMINAL_STATUSES.include?(record["status"]))
        atomic_yaml_write(run_yaml_path(run_dir), record)
        raise Error, "Memory promotion failed post-validation; canonical Memory was #{wrote_memory ? 'rolled back' : 'left unchanged'}; inspect evidence/memory-promotion-*.log"
      end

      update["status"] = "promoted"
      update["promoted_at"] ||= iso8601(now_utc)
      update["base_sha256"] = expected_hash
      update["written_sha256"] = current_hash
      update.delete("error")
      update["post_promotion"] = post_result
      validate_record!(record, context, run_dir, TERMINAL_STATUSES.include?(record["status"]))
      atomic_yaml_write(run_yaml_path(run_dir), record)
      puts "PROMOTED: #{update['entries'].join(', ')} -> #{context[:memory_file]}"
    ensure
      lock.flock(File::LOCK_UN) rescue nil
    end
  rescue Errno::ELOOP => e
    raise Error, "memory lock is unsafe: #{e.message}"
  end

  def terminal_run_entries(context)
    expected_run_dirs(context[:work_dir]).map do |run_dir|
      record = load_run(run_dir)
      next unless TERMINAL_STATUSES.include?(record["status"])
      canonical_run = run_dir.realpath
      validate_record!(record, context, canonical_run, true)
      finished = parse_iso8601(record["finished_at"], "finished_at")
      [canonical_run, record, finished]
    end.compact
  end

  def days_old(time, now)
    (now - time) / 86_400.0
  end

  def gc_actions(context, now)
    actions = []
    terminal_run_entries(context).each do |run_dir, record, finished|
      retention = record.dig("retention", "retention_rules")
      raise Error, "run record is missing retention.retention_rules: #{run_dir}" unless retention.is_a?(Hash)
      archived = path_within?(run_dir, context[:work_dir].join("archive"))
      age = days_old(finished, now)
      tmp = secure_run_subdirectory!(run_dir, "tmp")
      if !Dir.children(tmp.to_s).empty? && age >= retention["clear_terminal_tmp_after_days"]
        actions << { "action" => "clear-tmp", "path" => tmp.to_s, "run_dir" => run_dir.to_s }
      end
      if !archived && age >= retention["archive_terminal_runs_after_days"]
        started = parse_iso8601(record["started_at"], "started_at")
        destination = context[:work_dir].join("archive", started.strftime("%Y/%m/%d"), record["run_id"])
        actions << { "action" => "archive", "path" => run_dir.to_s, "destination" => destination.to_s }
      elsif archived && !retention["delete_archives_after_days"].nil? && age >= retention["delete_archives_after_days"]
        protected = retention["preserve_memory_conflicts"] && %w[conflict proposal-only].include?(record.dig("memory_update", "status"))
        actions << { "action" => "delete-archive", "path" => run_dir.to_s } unless protected
      end
    end
    actions
  end

  def secure_gc_run_dir!(path, context, expected_root = nil)
    roots = expected_root ? [context[:work_dir].join(expected_root)] : [context[:work_dir].join("runs"), context[:work_dir].join("archive")]
    lexical = Pathname.new(path).cleanpath
    resolved, = canonical_existing_entry_within!(lexical, roots, "GC run directory", :directory => true)
    raise Error, "GC run directory changed identity: #{lexical}" unless resolved == lexical
    resolved
  end

  def apply_gc_action(action, context)
    path = Pathname.new(action["path"])
    case action["action"]
    when "clear-tmp"
      run_dir = secure_gc_run_dir!(action.fetch("run_dir"), context)
      safe_tmp = secure_run_subdirectory!(run_dir, "tmp")
      raise Error, "GC tmp path changed after planning: #{path}" unless safe_tmp == path.cleanpath
      Dir.children(safe_tmp.to_s).each do |name|
        child = safe_tmp.join(name)
        safe_relative_components!(child, safe_tmp, "GC tmp entry")
        FileUtils.remove_entry_secure(child.to_s)
      end
    when "archive"
      path = secure_gc_run_dir!(path, context, "runs")
      destination = Pathname.new(action["destination"])
      archive_root = context[:work_dir].join("archive")
      destination_components = safe_relative_components!(destination, archive_root, "archive destination")
      raise Error, "archive destination must include date and run id: #{destination}" if destination_components.length < 4
      raise Error, "archive destination already exists: #{destination}" if destination.exist? || destination.symlink?
      mkdir_secure_tree(context[:work_dir], ["archive"] + destination_components[0...-1])
      raise Error, "archive destination parent changed identity: #{destination.dirname}" unless destination.dirname.realpath == destination.dirname.cleanpath
      File.rename(path.to_s, destination.to_s)
      destination, = canonical_existing_entry_within!(destination, [archive_root], "archived run directory", :directory => true)
      record = load_run(destination)
      record["retention"]["archived_at"] = iso8601(now_utc)
      atomic_yaml_write(run_yaml_path(destination), record)
    when "delete-archive"
      path = secure_gc_run_dir!(path, context, "archive")
      FileUtils.remove_entry_secure(path.to_s)
    else
      raise Error, "unknown GC action: #{action['action']}"
    end
  end

  def command_gc(argv)
    options, = parse_options!(argv, "Usage: agent-runtime.rb gc --role DIR [--apply] [options]") do |opt, values|
      common_options(opt, values)
      opt.on("--apply", "Apply reported actions (default is dry-run)") { values[:apply] = true }
      opt.on("--now ISO8601", "Evaluation time (testing/audit)") { |value| values[:now] = value }
    end
    context = resolve_context(options)
    now = options[:now] ? parse_iso8601(options[:now], "--now") : now_utc
    actions = gc_actions(context, now)
    mode = options[:apply] ? "APPLY" : "DRY-RUN"
    if actions.empty?
      puts "#{mode}: no retention actions"
      return
    end
    actions.each do |action|
      destination = action["destination"] ? " -> #{action['destination']}" : ""
      puts "#{mode}: #{action['action']} #{action['path']}#{destination}"
      apply_gc_action(action, context) if options[:apply]
    end
    puts "#{mode}: #{actions.length} retention action(s)"
  end

  def legacy_status(value)
    mapping = {
      "active" => "active", "in_progress" => "active", "in-progress" => "active", "in_review" => "active",
      "complete" => "complete", "completed" => "complete", "done" => "complete",
      "partial" => "partial", "blocked" => "blocked", "failed" => "failed", "cancelled" => "cancelled", "canceled" => "cancelled"
    }
    mapping[value.to_s.downcase] || "active"
  end

  def infer_workdir_from_run(path)
    current = path.dirname
    while current.parent != current
      return current.parent if current.basename.to_s == "runs" || current.basename.to_s == "archive"
      current = current.parent
    end
    nil
  end

  def normalize_legacy_path(value, run_dir, prefix, time)
    raw = value.is_a?(Hash) ? (value["path"] || value["file"]) : value
    return nil if raw.to_s.empty?
    path = Pathname.new(raw.to_s)
    path = run_dir.join(path) unless path.absolute?
    return nil unless path.exist? && path.file?
    resolved = path.realpath
    return nil unless path_within?(resolved, run_dir)
    relative = resolved.relative_path_from(run_dir).to_s
    return nil unless relative.start_with?(prefix + File::SEPARATOR)
    artifact_record(run_dir, relative, prefix, time)
  rescue Error, Errno::ENOENT
    nil
  end

  def legacy_values(value)
    case value
    when Array then value
    when Hash then value.values
    when nil then []
    else [value]
    end
  end

  def migrated_record(legacy, context, path)
    run_dir = path.dirname.realpath
    time = now_utc
    started_value = legacy["started_at"] || legacy["start_time"]
    started = started_value && !started_value.to_s.strip.empty? ? parse_iso8601(started_value.to_s, "legacy start time") : File.mtime(path.to_s).utc
    status = legacy_status(legacy["status"])
    finished_value = legacy["finished_at"] || legacy["end_time"]
    finished = finished_value && !finished_value.to_s.strip.empty? ? parse_iso8601(finished_value.to_s, "legacy end time") : nil
    finished ||= File.mtime(path.to_s).utc if TERMINAL_STATUSES.include?(status)
    run_id = legacy["run_id"].to_s
    run_id = run_dir.basename.to_s unless RUN_ID_PATTERN.match?(run_id)
    validate_run_id!(run_id)
    memory_hash = legacy["memory_sha256"].to_s
    memory_hash = sha256_file(context[:memory_file]) unless SHA256_PATTERN.match?(memory_hash)
    outputs = legacy_values(legacy["outputs"] || legacy["output_paths"]).map { |item| normalize_legacy_path(item, run_dir, "output", time) }.compact
    evidence = legacy_values(legacy["evidence"] || legacy["evidence_paths"]).map { |item| normalize_legacy_path(item, run_dir, "evidence", time) }.compact
    inputs = legacy_values(legacy["inputs"] || legacy["input_refs"]).map { |item| normalize_legacy_path(item, run_dir, "input", time) }.compact
    memory_status = legacy.dig("memory_update", "status").to_s
    memory_status = "none" unless MEMORY_STATUSES.include?(memory_status)
    memory_status = "pending" if status == "active" && memory_status == "none"
    known = %w[schema_version agent_id run_id goal tool started_at start_time finished_at end_time status profile memory memory_file memory_path memory_sha256 inputs input_refs outputs output_paths evidence evidence_paths approvals commands residual_work memory_update retention]
    unknown = legacy.reject { |key, _| known.include?(key) }
    residual = legacy_values(legacy["residual_work"]).map do |item|
      description = item.is_a?(Hash) ? (item["description"] || item.to_s) : item.to_s
      { "description" => description, "recorded_at" => iso8601(time) }
    end
    if status != "complete" && residual.empty? && legacy["notes"]
      residual << { "description" => legacy["notes"].to_s, "recorded_at" => iso8601(time) }
    end
    record = run_record(context, run_id, legacy["goal"].to_s.empty? ? "Legacy imported run" : legacy["goal"].to_s, legacy["tool"].to_s.empty? ? "legacy-import" : legacy["tool"].to_s, started)
    record["finished_at"] = finished ? iso8601(finished) : nil
    record["status"] = status
    record["memory"]["file"] = context[:memory_file].to_s
    record["memory"]["read_sha256"] = memory_hash
    record["inputs"] = inputs
    record["outputs"] = outputs
    record["evidence"] = evidence
    record["approvals"] = legacy["approvals"].is_a?(Array) ? legacy["approvals"] : []
    record["commands"] = legacy["commands"].is_a?(Array) ? legacy["commands"] : []
    record["residual_work"] = residual
    record["memory_update"]["status"] = memory_status
    record["memory_update"]["entries"] = legacy.dig("memory_update", "entries").is_a?(Array) ? legacy.dig("memory_update", "entries") : []
    record["retention"]["closed_at"] = record["finished_at"]
    record["extensions"] = { "legacy" => unknown } unless unknown.empty?
    record
  end

  def command_migrate_run(argv)
    legacy_arg = argv.shift
    options, parser = parse_options!(argv, "Usage: agent-runtime.rb migrate-run LEGACY_RUN_YAML --role DIR [--apply] [options]") do |opt, values|
      common_options(opt, values)
      opt.on("--apply", "Back up and replace legacy run.yaml") { values[:apply] = true }
    end
    raise Error.new("legacy run.yaml path is required\n#{parser}", 2) if legacy_arg.to_s.strip.empty?
    path = Pathname.new(File.expand_path(legacy_arg)).cleanpath
    raise Error, "legacy run record must be named run.yaml" unless path.basename.to_s == RUN_FILE_NAME
    role = resolve_role(options)
    profile_path, profile = read_profile(role)
    inferred_workdir = infer_workdir_from_run(path)
    raise Error, "could not infer Workdir root from legacy run path" unless inferred_workdir
    work_value = options[:work_dir] || inferred_workdir.to_s
    memory_value = options[:memory_file] || role.join("agent-soul", "MEMORY.md").to_s
    context_options = options.merge(:role => role.to_s, :work_dir => work_value, :memory_file => memory_value)
    context = resolve_context(context_options, :optional)
    context[:profile_path] = profile_path
    context[:profile] = profile
    configured_work_path = Pathname.new(File.expand_path(work_value)).cleanpath
    legacy_relative = safe_relative_components!(path, configured_work_path, "legacy run record")
    path = context[:work_dir].join(*legacy_relative).cleanpath
    allowed_roots = [context[:work_dir].join("runs"), context[:work_dir].join("archive")]
    canonical_path, = canonical_existing_entry_within!(path, allowed_roots, "legacy run record", :directory => false)
    raise Error, "legacy run record changed identity: #{path}" unless canonical_path == path
    original_stat = canonical_path.lstat
    original_identity = [original_stat.dev, original_stat.ino]
    original_text = canonical_path.read(encoding: "UTF-8")
    original_sha256 = Digest::SHA256.hexdigest(original_text)
    legacy = load_legacy_yaml(canonical_path)
    migrated = migrated_record(legacy, context, canonical_path)
    schema_errors = AgentWakerValidation.validate_against_schema(
      migrated,
      AgentWakerValidation::RUN_RECORD_SCHEMA_PATH
    )
    unless schema_errors.empty?
      raise Error, "legacy run cannot be migrated to a valid v1 record:\n- #{schema_errors.join("\n- ")}"
    end
    if options[:apply]
      apply_path, = canonical_existing_entry_within!(path, allowed_roots, "legacy run record", :directory => false)
      current_stat = apply_path.lstat
      unless apply_path == canonical_path && [current_stat.dev, current_stat.ino] == original_identity && sha256_file(apply_path) == original_sha256
        raise Error, "legacy run record changed after audit; refusing to migrate: #{path}"
      end
      File.chmod(0o700, context[:work_dir].to_s)
      ensure_sentinel!(context, :create)
      backup = Pathname.new(canonical_path.to_s + ".legacy.bak")
      raise Error, "legacy backup already exists; refusing to overwrite: #{backup}" if backup.exist? || backup.symlink?
      backup_flags = File::WRONLY | File::CREAT | File::EXCL | (File.const_defined?(:NOFOLLOW) ? File::NOFOLLOW : 0)
      File.open(backup.to_s, backup_flags, 0o600) do |file|
        file.write(original_text)
        file.flush
        file.fsync
      end
      %w[runs shared archive .locks].each { |name| mkdir_secure_tree(context[:work_dir], [name]) }
      relative_run = safe_relative_components!(canonical_path.dirname, context[:work_dir], "legacy run directory")
      raise Error, "legacy run directory must be under runs/ or archive/" unless %w[runs archive].include?(relative_run.first)
      mkdir_secure_tree(context[:work_dir], relative_run)
      run_dir = canonical_path.dirname
      RUN_SUBDIRECTORIES.each { |name| mkdir_secure_tree(run_dir, [name]) }
      proposal = run_dir.join(PROPOSAL_FILE_NAME)
      raise Error, "legacy memory proposal must not be a symbolic link: #{proposal}" if proposal.symlink?
      File.chmod(0o600, proposal.to_s) if proposal.file?
      atomic_yaml_write(canonical_path, migrated)
      begin
        validate_record!(migrated, context, run_dir, TERMINAL_STATUSES.include?(migrated["status"]))
      rescue Error => e
        original_mode = original_stat.mode & 0o777
        atomic_write(canonical_path, original_text, original_mode.zero? ? 0o600 : original_mode)
        raise Error, "migrated record failed v1 validation; original run.yaml was restored and backup retained: #{e.message}"
      end
      puts "MIGRATED: #{canonical_path} (backup: #{backup})"
    else
      puts "DRY-RUN: #{canonical_path} would migrate to Workdir v1; no files changed"
      puts YAML.dump(migrated)
    end
  end

  COMMANDS = {
    "start" => method(:command_start),
    "record" => method(:command_record),
    "close" => method(:command_close),
    "validate" => method(:command_validate),
    "validate-all" => method(:command_validate_all),
    "propose-memory" => method(:command_propose_memory),
    "promote-memory" => method(:command_promote_memory),
    "gc" => method(:command_gc),
    "migrate-run" => method(:command_migrate_run)
  }.freeze

  def run(argv)
    command = argv.shift
    if %w[-h --help help].include?(command)
      puts <<~HELP
        Usage: agent-runtime.rb <command> [options]

        Commands:
          start            Create a role-bound Workdir v1 run
          record           Atomically checkpoint an active run
          close            Close an active run through terminal gates
          validate         Validate one run record and its artifacts
          validate-all     Validate every run in the role Workdir
          propose-memory   Write a curated run-local Memory proposal
          promote-memory   Lock, hash-check, and atomically promote Memory
          gc               Report retention actions; --apply executes them
          migrate-run      Preview legacy conversion; --apply backs up and writes

        Run `agent-runtime.rb <command> --help` for command options.
      HELP
      return 0
    end
    unless COMMANDS.key?(command)
      raise Error.new("Usage: agent-runtime.rb <#{COMMANDS.keys.join('|')}> [options]", 2)
    end
    COMMANDS[command].call(argv)
    0
  rescue Error => e
    warn "ERROR: #{e.message}"
    e.exit_code
  rescue Interrupt
    warn "ERROR: interrupted"
    130
  end
end

exit AgentRuntime.run(ARGV) if $PROGRAM_NAME == __FILE__
