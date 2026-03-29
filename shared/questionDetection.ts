const INTERROGATIVE_STARTERS = [
  "what", "why", "how", "when", "where", "who", "which",
  "can", "could", "would", "should", "is", "are", "do", "does", "did",
  "have", "has", "will", "shall", "was", "were", "may", "might",
  "tell", "explain", "describe", "walk",
];

const QUESTION_PHRASES = [
  "tell me about",
  "tell me",
  "walk me through",
  "explain to me",
  "talk about",
  "give me an example",
  "what do you think",
  "what are your thoughts",
  "how would you",
  "how do you",
  "how did you",
  "can you describe",
  "can you explain",
  "could you tell",
  "could you explain",
  "difference between",
  "what is the difference",
  "why do you",
  "why did you",
  "where do you see",
  "what would you do",
  "what's your",
  "whats your",
  "what is your",
  "describe a time",
  "give an example",
  "share an experience",
  "elaborate on",
  "do you have experience",
  "do you have any experience",
  "do you have any certifications",
  "have you worked with",
  "have you used",
  "have you ever",
  "are you familiar with",
  "are you comfortable with",
  "what experience do you have",
  "what tools do you use",
  "what technologies do you",
  "why are you interested",
  "why do you want",
  "why should we hire",
  "what motivates you",
  "what are your strengths",
  "what are your weaknesses",
  "what salary",
  "when can you start",
  "tell us about",
  "talk us through",
  "give us an example",
  "share with us",
  "describe your experience",
  "describe your role",
  "what makes you",
  "hit me with",
  "hit us with",
  "hit me",
  "hit us",
  "go ahead and",
  "let's start with",
  "lets start with",
  "start with",
  // Topic-only interview phrases (no interrogative starter)
  "your thoughts on",
  "your opinion on",
  "your take on",
  "your approach to",
  "your perspective on",
  "any experience with",
  "any experience in",
  "any background in",
  "any knowledge of",
  "familiar with",
  "comfortable with",
  "experience with",
  "experience in",
  "background in",
  "talk me through",
  "talk us through",
  "share your experience",
  "share your background",
  "share a time",
  "thoughts on",
];

const INTERVIEW_INTENT_KEYWORDS = /\b(experience|worked|used|familiar|comfortable|exposure|background|hands on|knowledge|certification|strong in|thoughts?|opinion|approach|perspective|take)\b/i;
const SECOND_PERSON_DECLARATIVE = /^(you\s+(have|got|worked|used|built|implemented|handled|seen|ever|know)|youve\s+(worked|used|built|implemented|handled|seen)|youre\s+(familiar|comfortable)|your\s+(experience|background|role|work|skills?|knowledge|expertise)\s+(with|in|on|at|using|related)|your\s+(thoughts?|opinion|take|approach|perspective|view|understanding)\b)\b/i;

// Broader interview question signals: phrases that don't start with interrogatives but are clearly questions
export const INTERVIEW_SIGNAL_RE = /\b(your\s+(thoughts?|opinion|take|approach|perspective|view|understanding)\b|any\s+(experience|background|knowledge|exposure|familiarity|idea)\b|familiar\s+with\b|comfortable\s+with\b|experience\s+(with|in|using|on|of)\b|background\s+(in|with|on)\b|knowledge\s+of\b|exposure\s+to\b|talk\s+(me|us)\s+through\b|share\s+(your|a|an|with)\b|give\s+(me|us)\s+(an?\s+)?(example|idea|sense|overview|insight|walkthrough)\b|thoughts?\s+on\b|opinion\s+on\b|approach\s+to\b|worked?\s+with\b|done\s+any\b)\b/i;

// Standalone tech terms — interviewer says just "Flask" or "React and Vue" as a question cue
export const STANDALONE_TECH_RE = /^(?:react|angular|vue|svelte|nextjs|nuxtjs|gatsby|remix|astro|ember|backbone|jquery|bootstrap|tailwind|tailwindcss|chakra|antd|shadcn|materialui|storybook|nodejs|node|express|fastapi|flask|django|spring|springboot|rails|laravel|aspnet|nestjs|fastify|hapi|koa|gin|echo|fiber|phoenix|sinatra|tornado|sanic|aiohttp|typescript|javascript|python|java|golang|go|rust|kotlin|swift|scala|csharp|cpp|php|ruby|dart|elixir|clojure|haskell|fsharp|julia|perl|lua|bash|powershell|shell|cobol|matlab|postgres|postgresql|mysql|sqlite|mongodb|redis|cassandra|dynamodb|elasticsearch|solr|neo4j|influxdb|cockroachdb|mariadb|oracle|sqlserver|firestore|supabase|planetscale|fauna|couchbase|hbase|aurora|aws|azure|gcp|heroku|vercel|netlify|cloudflare|digitalocean|linode|railway|render|docker|kubernetes|k8s|terraform|ansible|chef|puppet|jenkins|githubactions|gitlabci|circleci|argocd|helm|vagrant|packer|kafka|rabbitmq|sqs|sns|pubsub|nats|zeromq|activemq|celery|tensorflow|pytorch|keras|sklearn|scikit|pandas|numpy|opencv|nltk|spacy|huggingface|langchain|llamaindex|llm|gpt|bert|transformers|xgboost|lightgbm|rag|spark|hadoop|airflow|flink|databricks|snowflake|dbt|looker|tableau|powerbi|redshift|bigquery|hive|presto|trino|graphql|grpc|websocket|rest|restful|http|https|tcp|udp|mqtt|amqp|oauth|jwt|saml|openid|microservices|monolith|serverless|eventdriven|cqrs|ddd|tdd|bdd|git|github|gitlab|bitbucket|jira|confluence|figma|postman|swagger|openapi|webpack|vite|rollup|babel|eslint|prettier|devops|sre|cicd|agile|scrum|kanban|dotnet|blazor|xamarin|unity|wpf|winforms|api|sdk|cli|oop|solid|mvc|mvvm|spa|pwa|ssr|csr|cdn|dns|vpn|ssl|tls|microservice|containerization|orchestration|html|css|sass|less|json|xml|yaml|toml|markdown|linux|ubuntu|debian|centos|macos|unix|stripe|twilio|sendgrid|datadog|sentry|pagerduty|splunk|newrelic|grafana|prometheus|sqlalchemy|alembic|pydantic|nginx|apache|gunicorn|uvicorn|wipro|anthem|tcs|infosys|cognizant|accenture|capgemini|deloitte|ibm|microsoft|google|amazon|meta|apple|netflix|uber|airbnb|backend|frontend|fullstack|devops|sysadmin|architect|engineer|developer|programmer|\.net)$/i;

function hasSecondPersonDeclarativeQuestionIntent(text: string): boolean {
  if (!SECOND_PERSON_DECLARATIVE.test(text) || !INTERVIEW_INTENT_KEYWORDS.test(text)) return false;
  // Guard: only treat as a question if the sentence ends with "?" (direct question)
  // OR if there is aux-verb inversion (verb before subject: "have you", "did you", "do you")
  // — not just "you have" (subject before verb) which is a declarative statement.
  if (/\?\s*$/.test(text)) return true;
  if (/\b(have|has|did|do|does|is|are|was|were|can|could|would|will|should)\s+you\b/i.test(text)) return true;
  return false;
}

function hasQuestionPunctuationSignal(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /\?/.test(raw) || /(?:^|[.!]\s+)(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|have|has)\b/i.test(raw);
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Shared ASR corrections used by both client transcript normalization and
// server-side question detection pipeline.
const ASR_FIXES: Array<[RegExp, string]> = [
  // ── Filler connector cleanup (must run first) ──
  // Keep the conjunction, drop the "also": "and also" → "and", "or also" → "or"
  [/\band\s+also\b/gi, "and"],
  [/\bor\s+also\b/gi, "or"],
  // Standalone "also" as connector before a word (e.g. "experience in also React" → "experience in React")
  [/\balso\s+(in\s+|with\s+)?(?=\w)/gi, "$1"],
  // ── Frameworks & Languages ──
  [/\bjango\b/gi, "Django"],
  [/\bgraph ?ql\b/gi, "GraphQL"],
  [/\bfast ?api?s?\b/gi, "FastAPI"],
  [/\brest(?:aurant)?\s+apis?\b/gi, "REST APIs"],
  [/\bpy(?:\s+)?spark\b/gi, "PySpark"],
  [/\bsparks by spark\b/gi, "Spark/PySpark"],
  [/\breact(?:ion)?\s+js\b/gi, "React.js"],
  [/\breact(?:ion)?\s+native\b/gi, "React Native"],
  [/\bnext(?:\s+)?js\b/gi, "Next.js"],
  [/\bnode(?:\s+)?js\b/gi, "Node.js"],
  [/\bvue(?:\s+)?js\b/gi, "Vue.js"],
  [/\bangular(?:\s+)?js\b/gi, "AngularJS"],
  [/\btype(?:\s+)?script\b/gi, "TypeScript"],
  [/\bjava(?:\s+)?script\b/gi, "JavaScript"],
  [/\bspring(?:\s+)?boot\b/gi, "Spring Boot"],
  [/\bhybernate\b/gi, "Hibernate"],
  [/\bmy(?:\s+)?sequel\b/gi, "MySQL"],
  [/\byes(?:\s+)?sequel\b/gi, "MySQL"],
  [/\bmy\s+s\s*q\s*l\b/gi, "MySQL"],
  [/\bpost(?:\s+)?gres(?:ql)?\b/gi, "PostgreSQL"],
  [/\bpost(?:\s+)?gray(?:s|sql)?\b/gi, "PostgreSQL"],
  [/\bmongo(?:\s+)?db\b/gi, "MongoDB"],
  [/\belastic(?:\s+)?search\b/gi, "Elasticsearch"],
  [/\bkuber(?:\s+)?net(?:es|is)?\b/gi, "Kubernetes"],
  [/\bkuberneti[sz]\b/gi, "Kubernetes"],
  [/\bdocker(?:\s+)?file\b/gi, "Dockerfile"],
  [/\bterraform\b/gi, "Terraform"],
  [/\bjenkins\b/gi, "Jenkins"],
  [/\bansible\b/gi, "Ansible"],
  [/\bprometheus\b/gi, "Prometheus"],
  [/\bgrafana\b/gi, "Grafana"],
  [/\bscikit(?:\s+|-)?learn\b/gi, "scikit-learn"],
  [/\btensor(?:\s+)?flow\b/gi, "TensorFlow"],
  [/\bpy(?:\s+)?torch\b/gi, "PyTorch"],
  [/\bpie(?:\s+)?torch\b/gi, "PyTorch"],
  [/\blang(?:\s+)?chain\b/gi, "LangChain"],
  [/\blanguid\b/gi, "LangChain"],
  [/\bopen(?:\s+)?ai\b/gi, "OpenAI"],
  [/\bhugging(?:\s+)?face\b/gi, "Hugging Face"],
  [/\bnum(?:\s+)?pie\b/gi, "NumPy"],
  [/\bcellar(?:y)?\b/gi, "Celery"],
  [/\brabbit(?:\s+)?mq\b/gi, "RabbitMQ"],
  [/\bkafka\b/gi, "Kafka"],
  [/\bair(?:\s+)?flow\b/gi, "Airflow"],
  [/\bdbt\b/gi, "dbt"],
  [/\bsnow(?:\s+)?flake\b/gi, "Snowflake"],
  [/\bdatabricks\b/gi, "Databricks"],
  [/\bspark(?:\s+)?sql\b/gi, "Spark SQL"],
  [/\bharted\b/gi, "Hadoop"],
  // ── Cloud & DevOps ──
  [/\baws(?:\s+)?lambda\b/gi, "AWS Lambda"],
  [/\bec(?:\s+)?2\b/gi, "EC2"],
  [/\bs(?:\s+)?3(?:\s+)?bucket\b/gi, "S3 bucket"],
  [/\bcloud(?:\s+)?formation\b/gi, "CloudFormation"],
  [/\bcloud\s+front\b/gi, "CloudFront"],
  [/\bapi(?:\s+)?gateway\b/gi, "API Gateway"],
  [/\bdynamo(?:\s+)?db\b/gi, "DynamoDB"],
  [/\bgoogle(?:\s+)?cloud(?:\s+)?platform\b/gi, "GCP"],
  [/\bbig(?:\s+)?query\b/gi, "BigQuery"],
  [/\bazure(?:\s+)?devops\b/gi, "Azure DevOps"],
  [/\bazure(?:\s+)?functions?\b/gi, "Azure Functions"],
  [/\bpub(?:\s+)?sub\b/gi, "Pub/Sub"],
  [/\bci(?:\s+)?cd\b/gi, "CI/CD"],
  [/\bcacd\b/gi, "CI/CD"],
  [/\bcic\s*d\b/gi, "CI/CD"],
  [/\bgit(?:\s+)?lab\b/gi, "GitLab"],
  [/\bgit(?:\s+)?hub(?:\s+)?actions?\b/gi, "GitHub Actions"],
  [/\bkitab\b/gi, "GitHub"],
  [/\bgit(?:\s+)?hub\b/gi, "GitHub"],
  // ── Architecture & Concepts ──
  [/\bmicro(?:\s+)?services?\b/gi, "microservices"],
  [/\bserver(?:\s+)?less\b/gi, "serverless"],
  [/\bobject(?:\s+)?oriented\b/gi, "object-oriented"],
  [/\bsolid(?:\s+)?principles?\b/gi, "SOLID principles"],
  [/\bdependency(?:\s+)?inject\w+\b/gi, "dependency injection"],
  [/\btest(?:\s+)?driven(?:\s+)?development\b/gi, "TDD"],
  // ── AI/ML ──
  [/\bmachine(?:\s+)?learning\b/gi, "machine learning"],
  [/\bdeep(?:\s+)?learning\b/gi, "deep learning"],
  [/\bnatural(?:\s+)?language(?:\s+)?processing\b/gi, "NLP"],
  [/\blarge(?:\s+)?language(?:\s+)?model\b/gi, "LLM"],
  [/\bretrieval(?:\s+)?augmented\b/gi, "retrieval-augmented"],
  [/\bfine(?:\s+)?tun\w+\b/gi, "fine-tuning"],
  [/\bvector(?:\s+)?database\b/gi, "vector database"],
  [/\bpin(?:\s+)?cone\b/gi, "Pinecone"],
  // ── Database/Auth ──
  [/\bno(?:\s+)?sql\b/gi, "NoSQL"],
  [/\bjson(?:\s+)?web(?:\s+)?token\b/gi, "JWT"],
  [/\boath\b/gi, "OAuth"],
  // ── Indian accent: Celery mishears (sounds like "salary") ──
  // Note: /\bsalary\b/ is intentionally NOT here — it's context-guarded in ASR_CONTEXTUAL_FIXES
  // to avoid converting real salary mentions to "Celery".
  [/\bsillary\b/gi, "Celery"],
  [/\bsel(?:e|a)ry\b/gi, "Celery"],
  [/\bsell(?:e|a)ry\b/gi, "Celery"],
  // ── Indian accent: Jenkins mishears ──
  [/\bjinkins\b/gi, "Jenkins"],
  [/\bjankins\b/gi, "Jenkins"],
  [/\bjenkin\b/gi, "Jenkins"],
  [/\bjinkin\b/gi, "Jenkins"],
  // ── Indian accent: Ansible mishears ──
  [/\bantible\b/gi, "Ansible"],
  [/\bansibel\b/gi, "Ansible"],
  [/\bancible\b/gi, "Ansible"],
  [/\buncible\b/gi, "Ansible"],
  [/\bansibull\b/gi, "Ansible"],
  // ── Indian accent: Terraform mishears ──
  [/\btera\s*form\b/gi, "Terraform"],
  [/\btear\s*a\s*form\b/gi, "Terraform"],
  [/\btear\s*form\b/gi, "Terraform"],
  [/\bterra\s*farm\b/gi, "Terraform"],
  [/\bterriform\b/gi, "Terraform"],
  // ── Indian accent: Vue.js mishears (w/v swap, "woo"/"view") ──
  [/\bwoo\s*js\b/gi, "Vue.js"],
  [/\bview\s*js\b/gi, "Vue.js"],
  [/\bvee\s*js\b/gi, "Vue.js"],
  [/\bwue\s*js\b/gi, "Vue.js"],
  [/\bwoo\b(?=\s+(framework|component|frontend|router))/gi, "Vue"],
  // ── Indian accent: Algorithm mishears ──
  [/\bal\s*gore\s*(?:rhythm|ithm|rithm)\b/gi, "algorithm"],
  [/\balgo\s*rism\b/gi, "algorithm"],
  [/\balgor(?:hythm|hism)\b/gi, "algorithm"],
  // ── Indian accent: Maven/Gradle mishears ──
  [/\bmavin\b/gi, "Maven"],
  [/\bmaben\b/gi, "Maven"],
  [/\bmayvn\b/gi, "Maven"],
  [/\bgradel\b/gi, "Gradle"],
  [/\bgraydel\b/gi, "Gradle"],
  [/\bgrade\s*l\b/gi, "Gradle"],
  // ── Indian accent: Jupyter/Anaconda ──
  [/\bjew\s*pit(?:er|a)\b/gi, "Jupyter"],
  [/\bjupiter\s*notebook\b/gi, "Jupyter Notebook"],
  [/\banna\s*conda\b/gi, "Anaconda"],
  // ── Indian accent: PyCharm/IntelliJ ──
  [/\bpie\s*charm\b/gi, "PyCharm"],
  [/\bpie\s*test\b/gi, "pytest"],
  [/\bpee\s*test\b/gi, "pytest"],
  [/\bintel(?:\s+)?i\s*j\b/gi, "IntelliJ"],
  [/\bintelect\s*j\b/gi, "IntelliJ"],
  // ── Indian accent: Tools ──
  [/\bpost\s*man\b/gi, "Postman"],
  [/\bbit\s*bucket\b/gi, "Bitbucket"],
  [/\bji\s*ra\b/gi, "Jira"],
  [/\bconfluens\b/gi, "Confluence"],
  [/\bvs\s*code\b/gi, "VS Code"],
  [/\bvisual\s*studio\s*code\b/gi, "VS Code"],
  // ── Indian accent: th→d pronunciation ──
  [/\bdreading\b(?=.*(?:thread|concurren|async|parallel))/gi, "threading"],
  [/\bdroughput\b/gi, "throughput"],
  [/\bdrewput\b/gi, "throughput"],
  [/\bdrottle\b/gi, "throttle"],
  [/\bthrough\s*put\b/gi, "throughput"],
  // ── Indian accent: w↔v swap ──
  [/\bwersion\b/gi, "version"],
  [/\bwariable\b/gi, "variable"],
  [/\binwoke\b/gi, "invoke"],
  [/\bwalid\b/gi, "valid"],
  [/\bwalidation\b/gi, "validation"],
  [/\bwalidate\b/gi, "validate"],
  [/\bwalidating\b/gi, "validating"],
  [/\bwirtual\b/gi, "virtual"],
  [/\bwulnerabilit\w+\b/gi, "vulnerability"],
  // ── Indian accent: DevOps/Agile mishears ──
  [/\bdev\s*ops\b/gi, "DevOps"],
  [/\bdebloy\b/gi, "deploy"],
  [/\bdebloyment\b/gi, "deployment"],
  [/\bdebloyed\b/gi, "deployed"],
  [/\bdebloying\b/gi, "deploying"],
  [/\bskrum\b/gi, "Scrum"],
  [/\bkanvan\b/gi, "Kanban"],
  [/\bkan\s*ban\b/gi, "Kanban"],
  // ── Indian accent: AWS services ──
  [/\bi\s*am\s*role\b/gi, "IAM role"],
  [/\biam\s*role\b/gi, "IAM role"],
  [/\bs\s*q\s*s\b/gi, "SQS"],
  [/\bs\s*n\s*s\b/gi, "SNS"],
  [/\bcloud\s*watch\b/gi, "CloudWatch"],
  [/\bload\s*balance[rd]?\b/gi, "load balancer"],
  [/\bauto\s*scaling\b/gi, "auto scaling"],
  [/\belas(?:tic)?\s*cache\b/gi, "ElastiCache"],
  [/\brds\b/gi, "RDS"],
  [/\baurora\s*(?:db)?\b/gi, "Aurora"],
  // ── Common speech mishears ──
  [/\bfootstep development\b/gi, "full stack development"],
  [/\bfood(?:\s+)?stack\b/gi, "full stack"],
  [/\bfoot(?:\s+)?stack\b/gi, "full stack"],
  [/\baid driven\b/gi, "AI-driven"],
  [/\bair driven\b/gi, "AI-driven"],
  [/\bfire\s*base\b/gi, "Firebase"],
  [/\bweb\s*pack\b/gi, "Webpack"],
  [/\bveet\b/gi, "Vite"],
  // ── PostgreSQL accented mishears ──
  [/\bpost\s*grease\s*(?:ql|cul|kul|cool)?\b/gi, "PostgreSQL"],
  [/\bpost\s*gre\s*sequel\b/gi, "PostgreSQL"],
  [/\bpost\s*(?:gress|grace|greys|graze)\b/gi, "PostgreSQL"],
  [/\bpastor\s*(?:gres|grace|greys)?\b/gi, "PostgreSQL"],
  // ── GraphQL accented mishears ──
  [/\bgraph\s*(?:cue\s*l|cul|cool|kul|queue\s*l)\b/gi, "GraphQL"],
  [/\bgraph\s*q\s*l\b/gi, "GraphQL"],
  // ── Kubernetes accented mishears ──
  [/\bkubernete?[sz]\b/gi, "Kubernetes"],
  [/\bkoo\s*ber\s*net(?:es|is|ez)?\b/gi, "Kubernetes"],
  [/\bk8s\b/gi, "Kubernetes"],
  // ── DynamoDB mishears ──
  [/\bdyna\s*mo\s*(?:db|d\s*b|database)\b/gi, "DynamoDB"],
  [/\bdynamo\s*d\s*b\b/gi, "DynamoDB"],
  // ── Redis mishears ──
  [/\bredis\b/gi, "Redis"],
  [/\bread\s*is\b/gi, "Redis"],
  // ── Kafka mishears ──
  [/\bkafka\b/gi, "Kafka"],
  [/\bcaf\s*ka\b/gi, "Kafka"],
  // ── React/Redux mishears ──
  [/\bre\s*dux\b/gi, "Redux"],
  [/\breact\s*redux\b/gi, "React Redux"],
  // ── Docker/Kubernetes tooling ──
  [/\bdocker\s*compose\b/gi, "Docker Compose"],
  [/\bkubectl\b/gi, "kubectl"],
  [/\bkube\s*ctl\b/gi, "kubectl"],
  // ── Other common mishears ──
  [/\bjunit\b/gi, "JUnit"],
  [/\bpytest\b/gi, "pytest"],
  [/\bnginx\b/gi, "Nginx"],
  [/\ben\s*jinx\b/gi, "Nginx"],
  [/\beng\s*inx\b/gi, "Nginx"],
  [/\bhas\s*kell\b/gi, "Haskell"],
  [/\brust(?:\s+lang(?:uage)?)?\b/gi, "Rust"],
  [/\bgolang\b/gi, "Go"],
  [/\bgo\s+lang(?:uage)?\b/gi, "Go"],
  [/\bsql\s*alchemy\b/gi, "SQLAlchemy"],
  [/\bpydantic\b/gi, "Pydantic"],
  [/\bfastify\b/gi, "Fastify"],
  [/\bexpress(?:\s+js)?\b/gi, "Express.js"],
  [/\bsocket\s*\.?\s*io\b/gi, "Socket.IO"],
  [/\bweb\s*socket\b/gi, "WebSocket"],
  [/\bopen\s*id\b/gi, "OpenID"],
  [/\bjson\s*web\s*token\b/gi, "JWT"],
  [/\bsaw\s*ml\b/gi, "SAML"],
  [/\bld\s*ap\b/gi, "LDAP"],
  // ── .NET / C# / Microsoft stack ──
  [/\bdot\s*net\b/gi, ".NET"],
  [/\basp\s*dot\s*net\b/gi, "ASP.NET"],
  [/\basp\s*net\b/gi, "ASP.NET"],
  [/\bc\s*sharp\b/gi, "C#"],
  [/\bc\s*plus\s*plus\b/gi, "C++"],
  [/\bsee\s*sharp\b/gi, "C#"],
  [/\bsee\s*plus\s*plus\b/gi, "C++"],
  [/\bdot\s*net\s*core\b/gi, ".NET Core"],
  [/\bentity\s*framework\b/gi, "Entity Framework"],
  [/\blazor\b/gi, "Blazor"],
  [/\bxaml\b/gi, "XAML"],
  [/\bnuget\b/gi, "NuGet"],
  // ── Grammar fixes ──
  [/\bwhere did you worked\b/gi, "Where did you work"],
  [/\bwhere do you work recently\b/gi, "Where do you work currently"],
  [/\btell me about you\b/gi, "Tell me about yourself"],
  [/\bcan you explain me\b/gi, "Can you explain"],
  [/\bexplain me\b/gi, "explain"],
];

const ASR_CONTEXTUAL_FIXES: Array<{ re: RegExp; to: string; when: RegExp }> = [
  { re: /\b(foster|flast|flash)\b/gi, to: "Flask", when: /\b(python|api|backend|django|fastapi)\b/i },
  { re: /\b(jango)\b/gi, to: "Django", when: /\b(python|api|backend|microservice)\b/i },
  { re: /\b(rest areas?|restaurant)\b/gi, to: "REST", when: /\b(api|graphql|backend|service)\b/i },
  { re: /\b(food stack|foot stack|footstep)\b/gi, to: "full stack", when: /\b(developer|engineer|python|java|react|django)\b/i },
  { re: /\breaction\b/gi, to: "React", when: /\b(component|hook|frontend|jsx|tsx|redux|state)\b/i },
  { re: /\bsequel\b/gi, to: "SQL", when: /\b(database|query|table|join|index|postgres|mysql)\b/i },
  { re: /\bspring\b/gi, to: "Spring", when: /\b(boot|java|microservice|hibernate|bean|mvc|jpa)\b/i },
  { re: /\bcellar\b/gi, to: "Celery", when: /\b(task|queue|worker|async|redis|rabbitmq|django)\b/i },
  { re: /\bsalary\b/gi, to: "Celery", when: /\b(task|queue|worker|async|redis|rabbitmq|django|beat|periodic)\b/i },
  { re: /\bview\b/gi, to: "Vue", when: /\b(js|framework|component|frontend|router|vuex|nuxt)\b/i },
  { re: /\bwoo\b/gi, to: "Vue", when: /\b(js|framework|component|frontend|router|vuex|nuxt)\b/i },
  { re: /\bmaven\b/gi, to: "Maven", when: /\b(build|java|pom|dependency|spring|gradle|jar)\b/i },
  { re: /\bgradle\b/gi, to: "Gradle", when: /\b(build|java|kotlin|android|dependency|spring)\b/i },
  { re: /\bjupiter\b/gi, to: "Jupyter", when: /\b(notebook|kernel|ipynb|cell|python|data)\b/i },
  { re: /\boath\b/gi, to: "OAuth", when: /\b(token|auth|login|sso|jwt|permission)\b/i },
  { re: /\bpin\s*cone\b/gi, to: "Pinecone", when: /\b(vector|embedding|llm|rag|similarity)\b/i },
  { re: /\bsparky?\b/gi, to: "Spark", when: /\b(hadoop|rdd|dataframe|pyspark|streaming)\b/i },
  { re: /\bhive\b/gi, to: "Hive", when: /\b(hadoop|query|warehouse|mapreduce)\b/i },
  { re: /\bair\s+flow\b/gi, to: "Airflow", when: /\b(dag|pipeline|etl|scheduler|task)\b/i },
  { re: /\bfire\s*base\b/gi, to: "Firebase", when: /\b(google|auth|realtime|database|mobile|cloud)\b/i },
  { re: /\bcacd|cic\s*d|ci\s*cd\b/gi, to: "CI/CD", when: /\b(pipeline|deploy|jenkins|github|automation)\b/i },
  { re: /\bhelm\b/gi, to: "Helm", when: /\b(kubernetes|chart|deploy|cluster|k8s)\b/i },
  { re: /\bveet\b/gi, to: "Vite", when: /\b(build|frontend|react|vue|bundle)\b/i },
  { re: /\bjest\b/gi, to: "Jest", when: /\b(test|unit|mock|react|coverage)\b/i },
  { re: /\bweb\s*pack\b/gi, to: "Webpack", when: /\b(bundle|build|module|react|frontend)\b/i },
];

export function applyAsrCorrections(raw: string): string {
  let text = (raw || "").replace(/\s+/g, " ").trim();
  if (!text) return text;
  for (const [re, to] of ASR_FIXES) {
    text = text.replace(re, to);
  }
  for (const rule of ASR_CONTEXTUAL_FIXES) {
    if (rule.when.test(text)) {
      text = text.replace(rule.re, rule.to);
    }
  }
  return text;
}

// "like" is stripped only when surrounded by other fillers (um like, you know like, like um)
// "so" is stripped only when it appears at the very start of the text as a pause filler
const FILLER_WORD_RE = /\b(uh+|um+|erm|hmm+|you know|sort of|kind of|basically|actually|literally|okay|ok)\b/g;
const FILLER_LIKE_RE = /\b(um+|uh+|erm|hmm+|you know)\s+like\b|\blike\s+(um+|uh+|erm|hmm+|you know)\b/gi;
const FILLER_SO_RE = /^so\s+/i;
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "being",
  "do", "does", "did", "to", "for", "of", "in", "on", "at", "by", "with",
  "and", "or", "but", "if", "then", "so", "that", "this", "it", "as", "from",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "they", "them",
]);

function stripRepeatedFillers(input: string): string {
  // Strip "like" only when flanked by other filler words (e.g. "um like", "like um")
  // Strip "so" only when it starts the sentence as a pause filler
  return input
    .replace(FILLER_LIKE_RE, " ")
    .replace(FILLER_SO_RE, "")
    .replace(FILLER_WORD_RE, " ")
    .replace(/\b(\w+)(\s+\1){1,}\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeQuestionForSimilarity(text: string): string {
  const normalized = normalizeText(text || "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized
    .split(" ")
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w))
    .join(" ");
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost,
      );
      prev = tmp;
    }
  }

  return dp[b.length];
}

export function levenshteinSimilarity(a: string, b: string): number {
  const left = (a || "").trim();
  const right = (b || "").trim();
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const dist = levenshteinDistance(left, right);
  const maxLen = Math.max(left.length, right.length) || 1;
  return 1 - dist / maxLen;
}

export function detectQuestionAdvanced(text: string): {
  isQuestion: boolean;
  confidence: number;
  type: "direct" | "indirect" | "command" | "unknown";
} {
  const raw = (text || "").toLowerCase().trim();
  if (!raw) {
    return { isQuestion: false, confidence: 0, type: "unknown" };
  }

  const normalized = stripRepeatedFillers(raw)
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(" ").filter(Boolean);
  // Strip leading filler words so "Alright, write a function..." detects "write" as a command starter
  const strippedNorm = normalized.replace(/^(alright|okay|ok|so|now|well|right|sure|let'?s|go ahead|actually|basically|essentially)[,.]?\s*/i, "").trim();
  const startsWh = /^(what|why|how|when|where|who|which)\b/.test(strippedNorm);
  const startsInterrogative = /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/.test(strippedNorm);
  const startsCommand = /^(explain|tell me|tell us|walk me|walk us|describe|share|give me|give us|talk me through|talk us through|your experience|your thoughts|your opinion|your take|your approach|any experience|familiar with|comfortable with|experience with|experience in|have you|are you familiar|are you comfortable|write|implement|build|create|design|code|generate|show me|make|develop|define|list|find|calculate|solve|convert|parse|sort|search|optimize|refactor)/.test(strippedNorm);

  let score = 0;
  if (/[?]\s*$/.test(normalized)) score += 0.5;
  if (startsInterrogative) score += 0.5;
  if (startsCommand) score += 0.4;
  if (startsInterrogative && words.length >= 3) score += 0.15;
  if (startsWh && words.length >= 4) score += 0.25;
  if (startsWh && words.length >= 3) score += 0.15;
  if (/\b(difference between|walk me through|tell me about|explain|what happens if|how would you)\b/.test(normalized)) score += 0.5;
  if (/\b(do you have experience|have you worked with|have you used|have you ever|are you familiar with|are you comfortable with|what was your|when did you|can you share|could you share|your experience with|your background in|your experience in|describe a time|give me an example|give an example|your thoughts on|your opinion on|your take on|your approach to|any experience with|any experience in|familiar with|comfortable with|thoughts on)\b/.test(normalized)) score += 0.35;
  // Standalone tech term with no other signals still warrants a small boost
  // Guard: only boost if a question word or "?" is present
  if (STANDALONE_TECH_RE.test(normalized) && words.length <= 5) {
    const hasQWord = /[?]\s*$/.test(normalized) || /\b(what|how|why|when|where|which|who|can|could|would|will|do|did|does|is|are|have|has|tell|explain|describe)\b/i.test(normalized);
    if (hasQWord) score += 0.3;
  }

  if (words.length > 8) score += 0.2;
  if (/\b(you|your)\b/.test(normalized)) score += 0.2;
  if (/\b(vs|compare|better than)\b/.test(normalized)) score += 0.2;

  const noQ = !normalized.includes("?");
  if (words.length < 4 && noQ) score -= 0.45;
  if (/(^|\s)[a-z]{1,3}-$/.test(normalized) || /\b(and|or|also)\s*$/.test(normalized)) score -= 0.6;
  if (/^(i have|i worked|my project|we built)\b/.test(normalized)) score -= 0.6;

  const confidence = Math.max(0, Math.min(1, score));
  const isQuestion = confidence >= 0.55;

  let type: "direct" | "indirect" | "command" | "unknown" = "unknown";
  if (/[?]\s*$/.test(normalized)) type = "direct";
  else if (startsCommand) type = "command";
  else if (startsInterrogative) type = "indirect";

  return { isQuestion, confidence, type };
}

export function normalize(text: string): string {
  return stripRepeatedFillers((text || "").toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCandidateSpan(text: string): string {
  const raw = (text || "").trim();
  if (!raw) return "";

  const byPunctuation = raw
    .split(/[.?!]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const punctuationUnits = byPunctuation.length > 0 ? byPunctuation : [raw];

  const joinerRe = /\b(and then|also|next|so|okay)\b/i;
  const units = punctuationUnits
    .flatMap((u) => u.split(joinerRe))
    .map((s) => s.trim())
    .filter(Boolean);

  const positives = [
    /\?$/,
    /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|have|has|will|was|were)\b/i,
    /\b(explain|describe|walk me through|tell me about|tell us about|talk me through|share your experience|share a time|give me an example|give an example|compare|difference between|what happens if|have you worked with|have you used|have you ever|are you familiar with|are you comfortable with|your experience with|your experience in|your background in|describe a time)\b/i,
  ];

  for (let i = units.length - 1; i >= 0; i--) {
    const candidate = units[i];
    if (positives.some((re) => re.test(candidate))) {
      return candidate;
    }
  }

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length <= 20) return raw;
  return words.slice(-20).join(" ");
}

export function fingerprint(span: string): string {
  return normalizeQuestionForSimilarity(extractCandidateSpan(span));
}

export function similarity(a: string, b: string): number {
  return levenshteinSimilarity(fingerprint(a), fingerprint(b));
}

export function detect(
  span: string,
  source: "partial" | "final" | "manual",
): {
  isQuestion: boolean;
  confidence: number;
  kind: "direct" | "imperative" | "implicit" | "unknown";
  cues: string[];
} {
  const text = normalize(span);
  if (!text) {
    return { isQuestion: false, confidence: 0, kind: "unknown", cues: [] };
  }

  const cues: string[] = [];
  let score = 0;

  if (/\?\s*$/.test(text)) { score += 0.55; cues.push("ends_with_qmark"); }
  if (hasQuestionPunctuationSignal(span) && !cues.includes("ends_with_qmark")) { score += 0.18; cues.push("punctuation_backup"); }
  if (/^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|have|has|will|was|were)\b/.test(text)) {
    score += 0.45; cues.push("starts_interrogative");
  }
  if (/\b(explain|describe|walk me through|tell me about|tell us about|talk me through|share your experience|share a time|give me an example|give an example|compare|difference between|what happens if|have you worked with|have you used|have you ever|are you familiar with|are you comfortable with|your experience with|your experience in|your background in|describe a time|describe your experience|your thoughts on|your opinion on|your take on|your approach to|any experience with|any experience in|familiar with|comfortable with|thoughts on|share your|background in|knowledge of)\b/.test(text)) {
    score += 0.35; cues.push("imperative_prompt");
  }
  // Standalone tech term (≤5 words) — "Flask", "React and Vue"
  // Guard: only boost if the segment also contains a question word or ends with "?"
  if (STANDALONE_TECH_RE.test(text) && text.split(/\s+/).filter(Boolean).length <= 5) {
    const hasQuestionWord = /\?\s*$/.test(text) || /\b(what|how|why|when|where|which|who|can|could|would|will|do|did|does|is|are|have|has|tell|explain|describe)\b/i.test(text);
    if (hasQuestionWord) { score += 0.3; cues.push("standalone_tech"); }
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 10) { score += 0.15; cues.push("len_ge_10"); }
  if (/\b(you|your)\b/.test(text)) { score += 0.20; cues.push("second_person"); }
  if (/\b(vs|compare)\b/.test(text)) { score += 0.15; cues.push("comparison"); }

  const hasStrongQuestionCue = cues.includes("starts_interrogative") || cues.includes("imperative_prompt") || cues.includes("ends_with_qmark") || cues.includes("standalone_tech");
  if (/^(i|we|my|our)\b/.test(text) && !hasStrongQuestionCue) {
    score -= 0.55; cues.push("self_statement");
  }
  if (words.length < 4 && !/\?$/.test(text) && !hasStrongQuestionCue) {
    score -= 0.35; cues.push("too_short_no_q");
  }

  if (/^(why|how|which one|how so|elaborate|explain|more|next|continue|show me|go on|keep going|proceed|expand|clarify|summarize|example|further|detail|go ahead|dive deeper|dig deeper|break it down|zoom in|say more|one more|what else|what next|and then)\??$/.test(text)) {
    score = Math.max(score, 0.72);
    cues.push("short_followup_allow");
  }

  if (source === "partial") {
    score -= 0.05;
  } else if (source === "manual") {
    score += 0.05;
  }

  const confidence = Math.max(0, Math.min(1, score));
  const isQuestion = confidence >= 0.6;
  let kind: "direct" | "imperative" | "implicit" | "unknown" = "unknown";
  if (/\?\s*$/.test(text)) kind = "direct";
  else if (/\b(explain|describe|walk me through|tell me about|tell us about|talk me through|share|give me an example|compare|have you worked|have you used|have you ever|are you familiar|are you comfortable|your experience|your background|describe a time|your thoughts|your opinion|your take|your approach|any experience|familiar with|comfortable with|thoughts on|background in|knowledge of)\b/.test(text) || cues.includes("standalone_tech")) kind = "imperative";
  else if (/^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|have|has|will|was|were)\b/.test(text)) kind = "implicit";

  return { isQuestion, confidence, kind, cues };
}

export function detectQuestion(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const advanced = detectQuestionAdvanced(text);
  if (advanced.isQuestion) return true;

  const normalized = normalizeText(text);
  const words = normalized.split(" ").filter(Boolean);
  const firstWord = words[0] || "";
  const twoWord = words.slice(0, 2).join(" ");
  const shortOneWordInterrogatives = new Set(["why", "how", "what", "which", "who", "when", "where", "elaborate", "explain", "continue", "more", "next", "expand", "clarify", "proceed", "further", "detail", "summarize", "example"]);
  const shortTwoWordQuestions = new Set([
    "how come", "what else", "why not", "which one", "how so", "what now",
    "who else", "what next", "which way", "what for", "who now",
    "show me", "keep going", "go on", "go ahead", "say more", "dive deeper",
    "dig deeper", "break down", "zoom in", "one more", "and then",
  ]);

  if (normalized.endsWith("?")) return true;

  if (words.length === 1 && shortOneWordInterrogatives.has(firstWord)) return true;
  if (words.length === 2 && shortTwoWordQuestions.has(twoWord)) return true;

  for (const phrase of QUESTION_PHRASES) {
    if (normalized.includes(phrase)) return true;
  }

  const auxVerbs = ["have", "has", "was", "were", "is", "are", "do", "does", "did", "will", "shall", "may", "might", "can", "could", "would", "should"];
  if (INTERROGATIVE_STARTERS.includes(firstWord)) {
    // Allow 2-word questions when ending with "?" (e.g. "Have you?", "Are you?")
    const endsWithQ = normalized.endsWith("?");
    const minWords = endsWithQ ? 2 : 3;
    if (words.length >= minWords) {
      if (auxVerbs.includes(firstWord)) {
        const secondWord = words[1] || "";
        const subjectWords = ["you", "your", "we", "they", "i", "he", "she", "it", "there", "anyone", "someone"];
        if (subjectWords.includes(secondWord)) return true;
      } else {
        return true;
      }
    }
  }

  if (/\b(can|could|would|should)\s+you\b/.test(normalized)) return true;
  if (/\b(do|does|did)\s+you\b/.test(normalized)) return true;
  if (/\b(are|is)\s+you\b/.test(normalized)) return true;
  if (/\b(have|has)\s+you\b/.test(normalized)) return true;
  if (hasSecondPersonDeclarativeQuestionIntent(normalized)) return true;

  if (normalized.includes("what") || normalized.includes("how") || normalized.includes("why")) {
    if (words.length >= 3) return true;
  }

  // Broader interview signals not caught above
  if (INTERVIEW_SIGNAL_RE.test(normalized)) return true;

  // Standalone tech term — widened to 10 words (e.g. "tell me about your Docker experience")
  // Guard: only fire if the segment also contains a question word or ends with "?"
  if (words.length <= 10 && STANDALONE_TECH_RE.test(normalized)) {
    const hasQuestionWord = /\?\s*$/.test(normalized) || /\b(what|how|why|when|where|which|who|can|could|would|will|do|did|does|is|are|have|has|tell|explain|describe)\b/i.test(normalized);
    if (hasQuestionWord) return true;
  }

  // Interview-intent statement without explicit question word
  // e.g. "Previous experience", "Python background", "AWS knowledge"
  // Exclude first-person (candidate's own speech)
  if (
    words.length >= 2 && words.length <= 12 &&
    !(/^(i |we |my |our )/.test(normalized)) &&
    INTERVIEW_INTENT_KEYWORDS.test(normalized)
  ) return true;

  return false;
}

export function likelyContainsQuestion(text: string): boolean {
  const normalized = normalizeText(text || "");
  if (!normalized) return false;

  if (normalized.includes("?")) return true;

  const words = normalized.split(" ").filter(Boolean);
  const firstWord = words[0] || "";
  if (INTERROGATIVE_STARTERS.includes(firstWord)) return true;

  if (/\b(can|could|would|should|do|does|did|are|is|have|has)\s+you\b/.test(normalized)) return true;
  if (/\b(tell me|walk me through|describe|explain|hit me with|talk about)\b/.test(normalized)) return true;
  if (hasSecondPersonDeclarativeQuestionIntent(normalized)) return true;

  // Broader interview signals — "your thoughts on X", "any experience with X", "familiar with X" etc.
  if (INTERVIEW_SIGNAL_RE.test(normalized)) return true;

  // Standalone tech term (1–5 words) — interviewer says "Flask" or "React and Vue"
  // Guard: only fire if the segment also contains a question word or ends with "?"
  if (words.length <= 5 && STANDALONE_TECH_RE.test(normalized)) {
    const hasQuestionWord = /\?\s*$/.test(normalized) || /\b(what|how|why|when|where|which|who|can|could|would|will|do|did|does|is|are|have|has|tell|explain|describe)\b/i.test(normalized);
    if (hasQuestionWord) return true;
  }

  return false;
}

export function isAffirmation(text: string): boolean {
  const normalized = normalizeText(text || "");
  if (!normalized) return false;
  return /^(yes|yeah|yep|sure|correct|right|sounds good|go ahead|please do|ok|okay)\b/.test(normalized);
}

export function isNegation(text: string): boolean {
  const normalized = normalizeText(text || "");
  if (!normalized) return false;
  return /^(no|nope|not really|dont|do not|not necessary|no thanks)\b/.test(normalized);
}

export function detectMetaRequest(text: string): "brief" | "deeper" | null {
  const normalized = normalizeText(text || "");
  if (!normalized) return null;

  if (/\b(brief|short|quick|summarize|summary|high level|in summary)\b/.test(normalized)) {
    return "brief";
  }
  if (/\b(elaborate|more detail|detailed|deep dive|go deeper|expand)\b/.test(normalized)) {
    return "deeper";
  }

  return null;
}

export function classifyQuestion(text: string): "technical" | "behavioral" | "clarification" | "other" {
  const normalized = normalizeText(text);

  const technicalKeywords = [
    "algorithm", "data structure", "code", "implement", "design", "system",
    "database", "api", "architecture", "complexity", "optimize", "debug",
    "function", "class", "interface", "typescript", "javascript", "python",
    "react", "node", "sql", "rest", "graphql", "docker", "kubernetes",
    "aws", "cloud", "microservice", "scalab", "performance", "cache",
    "memory", "thread", "async", "deploy", "ci/cd", "testing", "git",
    "framework", "library", "stack", "backend", "frontend", "fullstack",
    "oop", "solid", "pattern", "recursion", "sorting", "binary",
    "hash", "tree", "graph", "queue", "linked list", "array",
  ];

  const behavioralKeywords = [
    "tell me about a time", "describe a situation", "give me an example",
    "how did you handle", "what would you do", "challenge", "conflict",
    "leadership", "team", "mistake", "failure", "success", "achievement",
    "proud", "difficult", "disagreement", "feedback", "prioritize",
    "strength", "weakness", "motivation", "collaborate", "experience with",
    "walk me through", "tell me about yourself", "why do you want",
    "where do you see", "biggest accomplishment", "time when you",
  ];

  const clarificationKeywords = [
    "what do you mean", "could you clarify", "can you elaborate",
    "could you repeat", "what exactly", "in what sense",
    "sorry", "didn't understand", "please explain", "more specific",
    "example of that", "what kind of",
  ];

  for (const kw of clarificationKeywords) {
    if (normalized.includes(kw)) return "clarification";
  }
  for (const kw of behavioralKeywords) {
    if (normalized.includes(kw)) return "behavioral";
  }
  for (const kw of technicalKeywords) {
    if (normalized.includes(kw)) return "technical";
  }

  return "other";
}

export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(/(?<=[.!?])\s+/);
  return parts.map(s => s.trim()).filter(s => s.length > 0);
}

export function extractLastSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const sentences = splitSentences(trimmed);
  if (sentences.length === 0) return trimmed;

  return sentences[sentences.length - 1].trim();
}

export function isMixedSpeakerSegment(segment: string): boolean {
  const words = segment.trim().split(/\s+/);
  if (words.length > 40) return true;

  const iStatements = /\b(i have|i am|i was|i did|i worked|i built|i created|i implemented|i used|i developed|my experience|my role|my team|in my|at my company|i've been|i've worked|i managed|i led)\b/i;
  const questionPhrases = /\b(what are|what is|what do|how do|how would|can you|could you|tell me|describe|explain|do you have|have you|are you)\b/i;

  if (iStatements.test(segment) && questionPhrases.test(segment)) {
    return true;
  }

  return false;
}

export function extractQuestionFromSegment(segment: string): string | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 2 && detectQuestion(trimmed)) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  if (isMixedSpeakerSegment(trimmed)) {
    const sentences = splitSentences(trimmed);
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentence = sentences[i].trim();
      if (sentence.split(/\s+/).length >= 1 && sentence.split(/\s+/).length <= 30 && detectQuestion(sentence)) {
        return sentence.charAt(0).toUpperCase() + sentence.slice(1);
      }
    }

    const questionStart = trimmed.search(/\b(what|why|how|when|where|who|which|can you|could you|would you|do you|have you|are you|tell me|explain|describe|walk me|hit me with|hit us with|you have|youve|youre)\b/i);
    if (questionStart > 0) {
      const questionPart = trimmed.slice(questionStart).trim();
      const qWords = questionPart.split(/\s+/);
      if (qWords.length >= 1 && qWords.length <= 25 && detectQuestion(questionPart)) {
        return questionPart.charAt(0).toUpperCase() + questionPart.slice(1);
      }
    }

    return null;
  }

  const fillerPrefixes = [
    /^(so\s+)?ok(ay)?\s+(so\s+)?/i,
    /^(so\s+)?(um|uh|hmm|well|like|right|yeah|yes|alright|sure)\s+/i,
    /^(and\s+)?(the\s+)?(next|another|following)\s+(question\s+)?(is\s+)?/i,
    /^(question\s+(is\s+)?)/i,
    /^(let me ask you\s+)/i,
    /^(i want to ask\s+)/i,
    /^(i('d| would) like to (ask|know)\s+)/i,
    /^(can i ask\s+)/i,
  ];

  let cleaned = trimmed;
  for (const prefix of fillerPrefixes) {
    cleaned = cleaned.replace(prefix, "");
  }
  cleaned = cleaned.trim();
  if (cleaned.length < 5) cleaned = trimmed;

  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  if (detectQuestion(cleaned)) return cleaned;

  const sentences = splitSentences(trimmed);
  if (sentences.length > 1) {
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentence = sentences[i].trim();
      if (sentence.split(/\s+/).length >= 1 && detectQuestion(sentence)) {
        return sentence.charAt(0).toUpperCase() + sentence.slice(1);
      }
    }
  }

  const questionStart = cleaned.search(/\b(what|why|how|when|where|who|which|can you|could you|would you|do you|have you|are you|tell me|explain|describe|walk me|hit me with|hit us with|you have|youve|youre)\b/i);
  if (questionStart >= 0) {
    const questionPart = cleaned.slice(questionStart).trim();
    if (questionPart && detectQuestion(questionPart)) {
      return questionPart.charAt(0).toUpperCase() + questionPart.slice(1);
    }
  }

  return null;
}

export function isSubstantiveSegment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/);
  if (words.length < 2) return false;

  if (trimmed.length < 5) return false;

  const fillerOnly = /^(um|uh|hmm|oh|ah|ok|okay|yes|no|yeah|nah|right|sure|well|so|like|thanks|thank you|bye|hello|hi|hey)$/i;
  if (fillerOnly.test(trimmed)) return false;

  const nonAlphaRatio = (trimmed.replace(/[a-zA-Z\s]/g, "").length) / trimmed.length;
  if (nonAlphaRatio > 0.5) return false;

  return true;
}

export type QuestionDepth = "simple" | "moderate" | "complex" | "deep";

export function analyzeQuestionDepth(text: string): QuestionDepth {
  const normalized = normalizeText(text);
  const words = normalized.split(" ");
  const wordCount = words.length;
  let score = 0;

  if (wordCount >= 30) score += 3;
  else if (wordCount >= 18) score += 2;
  else if (wordCount >= 10) score += 1;

  const deepIndicators = [
    "design a system", "system design", "architect", "trade-off", "tradeoff",
    "compare and contrast", "pros and cons", "optimize", "scale",
    "distributed", "microservice", "end to end", "from scratch",
    "production ready", "high availability", "fault tolerant",
    "walk me through the entire", "step by step", "in depth",
    "comprehensive", "deep dive", "elaborate", "thoroughly",
    "all aspects", "detailed explanation", "full implementation",
  ];
  for (const ind of deepIndicators) {
    if (normalized.includes(ind)) { score += 3; break; }
  }

  const complexIndicators = [
    "algorithm", "data structure", "implement", "complexity",
    "recursion", "dynamic programming", "binary search", "graph",
    "tree traversal", "linked list", "hash map", "sorting",
    "database design", "schema", "migration", "index",
    "concurrent", "async", "thread", "deadlock", "race condition",
    "security", "authentication", "authorization", "encryption",
    "performance", "benchmark", "profiling", "memory leak",
    "ci/cd", "pipeline", "deployment strategy", "containeriz",
    "machine learning", "neural network", "training",
    "explain how", "explain why", "what happens when",
    "difference between", "how does.*work", "under the hood",
  ];
  for (const ind of complexIndicators) {
    if (normalized.includes(ind) || new RegExp(ind).test(normalized)) { score += 2; break; }
  }

  const moderateIndicators = [
    "example", "describe", "tell me about", "experience",
    "how would you", "what approach", "best practice",
    "recommendation", "suggest", "advice", "opinion",
    "challenge", "problem", "solution", "strategy",
    "framework", "library", "tool", "technology",
  ];
  for (const ind of moderateIndicators) {
    if (normalized.includes(ind)) { score += 1; break; }
  }

  const category = classifyQuestion(text);
  if (category === "technical") score += 1;

  if (normalized.includes("and") || normalized.includes("also") || normalized.includes("additionally")) {
    score += 1;
  }

  if (score >= 6) return "deep";
  if (score >= 4) return "complex";
  if (score >= 2) return "moderate";
  return "simple";
}

export function selectModelForDepth(depth: QuestionDepth, availableModels: string[]): string {
  const modelTiers: Record<QuestionDepth, string[]> = {
    deep: ["gpt-5", "o3", "gemini-2.5-pro"],
    complex: ["gpt-5-mini", "gpt-4.1", "o4-mini", "gemini-2.5-flash"],
    moderate: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o", "gemini-2.5-flash"],
    simple: ["gpt-5-nano", "gpt-4o-mini", "gpt-4.1-mini", "gemini-2.0-flash"],
  };

  const preferred = modelTiers[depth];
  for (const model of preferred) {
    if (availableModels.includes(model)) return model;
  }
  return availableModels[0] || "gpt-5-mini";
}

export function normalizeForDedup(text: string): string {
  return normalizeText(text)
    .replace(/\?/g, "")
    .replace(/\b(um|uh|like|you know|so|well|basically|actually|right)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeWordOverlap(textA: string, textB: string): number {
  const wordsA = textA.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.length === 0) return 0;
  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) matches++;
  }
  return matches / wordsA.length;
}

export function isNovelQuestion(newQuestion: string, lastQuestion: string, recentAiOutputs: string[]): boolean {
  if (!lastQuestion) return true;

  const overlapWithLast = computeWordOverlap(newQuestion, lastQuestion);
  if (overlapWithLast > 0.6) return false;

  for (const aiOutput of recentAiOutputs) {
    const overlapWithAi = computeWordOverlap(newQuestion, aiOutput);
    if (overlapWithAi > 0.45) return false;
  }

  return true;
}

export type QuestionPatternLabel =
  | "direct"
  | "one_word"
  | "keyword_prompt"
  | "multi_question"
  | "followup"
  | "rapid_fire"
  | "pause_based"
  | "incomplete_prompt"
  | "interrupt"
  | "drill_down"
  | "scenario"
  | "comparison"
  | "challenge"
  | "rephrased_repeat"
  | "silent_pressure"
  | "binary"
  | "metric_demand"
  | "ownership_test"
  | "ambiguous"
  | "clarification"
  | "resume_pointer"
  | "assumption_check"
  | "behavioral"
  | "broad_to_narrow"
  | "narrow_to_broad";

export type QuestionAnswerability = "complete" | "fragment" | "no_question";
export type QuestionAnchor = "none" | "current_window" | "previous_answer";

export interface FramedQuestionItem {
  text: string;
  norm: string;
  labels: QuestionPatternLabel[];
  confidence: number;
  answerability: QuestionAnswerability;
}

export interface FramedQuestionResult {
  rawText: string;
  normalizedText: string;
  labels: QuestionPatternLabel[];
  answerability: QuestionAnswerability;
  anchor: QuestionAnchor;
  questions: FramedQuestionItem[];
  windowHash: string;
  confidence: number;
  cleanQuestion: string;
  isQuestion: boolean;
}

function simpleStableHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function ensureSentenceCase(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function ensureQuestionMark(text: string): string {
  const trimmed = String(text || "").trim().replace(/[.]\s*$/, "");
  if (!trimmed) return "";
  return /[?]$/.test(trimmed) ? trimmed : `${trimmed}?`;
}

function isFollowupPhrase(normalized: string): boolean {
  return /^(why|how|how so|how come|what happened next|what next|what else|tell me more|go deeper|dig deeper|dive deeper|go on|continue|expand|elaborate|clarify|break it down|example|give me one example|real case|when exactly|who decided|what was your part|how do you know|why that)\??$/.test(normalized);
}

function isPauseOrIncompletePrompt(normalized: string): boolean {
  if (!normalized) return false;
  if (/^(and|also|plus|or|so|hmm|hm|okay|ok|right|wait|hold on|then|next|backend|frontend|database|project|team|testing|scale|yourself|role|outcome|after that)\??$/.test(normalized)) {
    return true;
  }
  if (/\b(in|with|at|for|on|about|of|from|to|by|and|or|the|a|an|any|some|your|our|their|its|this|that|these|those)\s*$/.test(normalized)) {
    return true;
  }
  return /^(and your|and after|and the outcome|tell me about|what about|can you|could you|would you|do you|have you|are you|wait who|hold on did)\s*$/.test(normalized)
    && !/[?]$/.test(normalized);
}

function detectPatternLabelsInternal(text: string): QuestionPatternLabel[] {
  const normalized = normalizeForDedup(text || "");
  if (!normalized) return [];

  const labels = new Set<QuestionPatternLabel>();
  const words = normalized.split(/\s+/).filter(Boolean);

  if (/[?]$/.test(String(text || "").trim()) || /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|have|has|tell|explain|describe|walk)\b/.test(normalized)) {
    labels.add("direct");
  }
  if (words.length === 1) labels.add("one_word");
  if ((words.length <= 4 && STANDALONE_TECH_RE.test(normalized)) || /^(polymorphism|normalization|caching|database|project|team|scale|testing)$/.test(normalized)) {
    labels.add("keyword_prompt");
  }
  if (isFollowupPhrase(normalized) || /^(and your|and after that|and the outcome|what do you mean|what exactly was your contribution)\b/.test(normalized)) {
    labels.add("followup");
  }
  if (/^(wait|hold on)\b/.test(normalized)) labels.add("interrupt");
  if (/\b(go deeper|explain in detail|how exactly|under the hood|drill down)\b/.test(normalized)) labels.add("drill_down");
  if (/\b(what if|suppose|assume)\b/.test(normalized)) labels.add("scenario");
  if (/\b(vs|versus|compare|difference between|better than)\b/.test(normalized)) labels.add("comparison");
  if (/\b(are you sure|why not|that sounds expensive|but you said)\b/.test(normalized)) labels.add("challenge");
  if (/^(yes or no|did you|did it|do you)\b/.test(normalized)) labels.add("binary");
  if (/\b(how much|how many|what latency|what percentage|what was the improvement)\b/.test(normalized)) labels.add("metric_demand");
  if (/\b(not the team|what exactly did you do|what was your part|your contribution)\b/.test(normalized)) labels.add("ownership_test");
  if (/\b(i see .* here|you mentioned|this startup experience)\b/.test(normalized)) labels.add("resume_pointer");
  if (/\b(so you were|so this was|so you deployed)\b/.test(normalized)) labels.add("assumption_check");
  if (/\b(tell me about a time|give me an example when|describe a situation)\b/.test(normalized)) labels.add("behavioral");
  if (/\b(focus on|focus only on)\b/.test(normalized)) labels.add("broad_to_narrow");
  if (/^(how did .* work|how did login work)\b/.test(normalized) || /\b(explain the whole architecture|whole architecture)\b/.test(normalized)) {
    labels.add("narrow_to_broad");
  }
  if (/^(right|correct|fair)\??$/.test(normalized)) labels.add("silent_pressure");
  if (isPauseOrIncompletePrompt(normalized)) labels.add("incomplete_prompt");
  if (/(\?|^)\s*(what|why|how|who|which|where|when|tell me|explain|describe|do you|have you|are you|can you|could you|would you)\b/gi.test(normalized) && splitSentences(ensureQuestionMark(text)).length > 1) {
    labels.add("multi_question");
  }
  if (/\b(and then|who decided|what was your part|how do you know|what happened next)\b/.test(normalized)) labels.add("rapid_fire");
  if (/\.\.\.|^so\b|^hmm\b|^okay\b/.test(String(text || "").trim().toLowerCase())) labels.add("pause_based");
  if (/\b(what do you mean|can you clarify|could you clarify|what exactly)\b/.test(normalized)) labels.add("clarification");
  if (!labels.size && likelyContainsQuestion(text)) labels.add("ambiguous");

  return Array.from(labels);
}

export function detectQuestionPatternLabels(text: string): QuestionPatternLabel[] {
  return detectPatternLabelsInternal(text);
}

function splitQuestionUnits(text: string): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const splitByLines = raw
    .split(/\n+|\|+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const withSentenceBreaks = part
        .replace(/([?])\s+(?=(what|why|how|when|where|who|which|tell me|explain|describe|walk me|do you|have you|are you|can you|could you|would you)\b)/gi, "$1\n")
        .replace(/,\s+(?=(what|why|how|when|where|who|which|tell me|explain|describe|walk me|do you|have you|are you|can you|could you|would you)\b)/gi, "\n");
      return withSentenceBreaks.split(/\n+/).map((item) => item.trim()).filter(Boolean);
    });

  return splitByLines;
}

export function questionSupersedes(candidate: string, existing: string): boolean {
  const next = normalizeForDedup(candidate || "");
  const prev = normalizeForDedup(existing || "");
  if (!next || !prev || next === prev) return false;

  const nextWords = next.split(/\s+/).filter(Boolean);
  const prevWords = prev.split(/\s+/).filter(Boolean);
  if (nextWords.length < prevWords.length) return false;

  const overlap = Math.max(computeWordOverlap(next, prev), computeWordOverlap(prev, next));
  const prevLooksFragment = prevWords.length <= 4 || isPauseOrIncompletePrompt(prev) || isFollowupPhrase(prev);
  if (prevLooksFragment && (next.includes(prev) || overlap >= 0.66)) return true;

  const prevPrefix = prevWords.join(" ");
  return Boolean(prevPrefix && next.startsWith(prevPrefix) && next.length > prev.length + 4);
}

export function dedupeAndSupersedeQuestions(questions: string[]): string[] {
  const result: string[] = [];
  for (const raw of questions) {
    const next = ensureSentenceCase(String(raw || "").trim());
    if (!next) continue;
    const nextNorm = normalizeForDedup(next);
    if (!nextNorm) continue;

    let suppressed = false;
    for (let i = result.length - 1; i >= 0; i--) {
      const current = result[i];
      const currentNorm = normalizeForDedup(current);
      if (!currentNorm) continue;
      if (currentNorm === nextNorm || questionSupersedes(current, next)) {
        suppressed = true;
        break;
      }
      if (questionSupersedes(next, current)) {
        result.splice(i, 1);
      }
    }
    if (!suppressed) result.push(next);
  }
  return result;
}

export function buildQuestionWindowHash(text: string): string {
  const normalized = normalizeForDedup(String(text || ""));
  return normalized ? `qwin_${simpleStableHash(normalized)}` : "";
}

function stripSpeakerPrefix(text: string): string {
  return String(text || "").replace(/^\s*(?:interviewer|candidate)\s*:\s*/i, "").trim();
}

function lowercaseFirst(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function isTopicAppendableQuestion(text: string): boolean {
  const normalized = normalizeForDedup(stripSpeakerPrefix(text));
  if (!normalized) return false;
  if (/(tell me about|describe a time|share an experience|conflict|manager|yourself|strength|weakness|background)\b/.test(normalized)) {
    return false;
  }
  return /\b(experience|worked with|worked on|used|use|familiar with|comfortable with|background in|knowledge of|exposure to|skills|stack|technologies|tools)\b/.test(normalized)
    || /\b(?:do|does|did|have|has|are|is|can|could|would)\s+you\b/.test(normalized);
}

function isSafeTopicTail(text: string): boolean {
  const normalized = normalizeForDedup(text);
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (/^(and|also|plus|or|what about|how about|more|detail|details|it|that|this)$/i.test(normalized)) return false;
  if (STANDALONE_TECH_RE.test(normalized)) return true;
  return /\b(api|backend|frontend|cloud|database|sql|nosql|devops|microservices?|system design|project|architecture|testing|security|scalability|performance|storage|bucket|account)\b/i.test(normalized);
}

export function mergeFollowupQuestion(previousQuestion: string, fragment: string): string {
  const prev = ensureQuestionMark(stripSpeakerPrefix(previousQuestion));
  const rawFragment = stripSpeakerPrefix(fragment);
  const fragmentNorm = normalizeForDedup(rawFragment);
  if (!prev || !fragmentNorm) return "";

  const prevBase = prev.replace(/[?]+\s*$/, "").trim();
  if (!prevBase) return "";

  if (/^(explain more|tell me more|go deeper|dig deeper|dive deeper|elaborate|elaborate more|in detail|more detail|clarify|break it down|expand|expand on that|can you elaborate|can you explain more)\??$/i.test(fragmentNorm)) {
    return ensureQuestionMark(`Explain more about ${lowercaseFirst(prevBase)}`);
  }

  if (/^(why|how|what happened next|what next|what else|who decided|what was your part|how do you know)\??$/i.test(fragmentNorm)) {
    return ensureQuestionMark(`${ensureSentenceCase(rawFragment.replace(/[?]+\s*$/, ""))} about ${lowercaseFirst(prevBase)}`);
  }

  const connectorMatch = /^(and also|and|also|plus|or|what about|how about)\s+/i.exec(rawFragment);
  const tail = rawFragment.replace(/^(and also|and|also|plus|or|what about|how about)\s+/i, "").replace(/[?]+\s*$/, "").trim();
  const connector = connectorMatch?.[1]?.toLowerCase() || "";
  const appendWith = connector === "or" ? "or" : "and";

  if (isTopicAppendableQuestion(prevBase) && isSafeTopicTail(tail)) {
    return ensureQuestionMark(`${prevBase} ${appendWith} ${tail}`);
  }

  if (/^(yourself|role|your role|the outcome|outcome|after that)\??$/i.test(fragmentNorm) && /\b(tell me about|and your|what is your)\b/i.test(normalizeForDedup(prevBase))) {
    return ensureQuestionMark(`${prevBase} ${rawFragment.replace(/[?]+\s*$/, "").trim()}`);
  }

  return "";
}

export function frameQuestionWindow(
  text: string,
  options?: { previousQuestion?: string },
): FramedQuestionResult {
  const rawText = String(text || "").trim();
  const normalizedText = normalizeForDedup(rawText);
  const labels = detectPatternLabelsInternal(rawText);
  const windowHash = buildQuestionWindowHash(rawText);

  if (!normalizedText) {
    return {
      rawText,
      normalizedText,
      labels,
      answerability: "no_question",
      anchor: "none",
      questions: [],
      windowHash,
      confidence: 0,
      cleanQuestion: "",
      isQuestion: false,
    };
  }

  const extracted = extractQuestionFromSegment(rawText);
  const units = splitQuestionUnits(rawText);
  const explicitQuestions = dedupeAndSupersedeQuestions(
    units
      .map((unit) => extractQuestionFromSegment(unit) || (detectQuestion(unit) ? ensureSentenceCase(unit.trim()) : ""))
      .filter(Boolean)
      .map((unit) => ensureQuestionMark(unit)),
  );

  const answerability: QuestionAnswerability = (() => {
    if (labels.includes("one_word") || labels.includes("keyword_prompt") || labels.includes("pause_based") || labels.includes("incomplete_prompt")) {
      return "fragment";
    }
    if (!detectQuestion(rawText) && !likelyContainsQuestion(rawText) && !extracted && explicitQuestions.length === 0) {
      return "no_question";
    }
    if (isPauseOrIncompletePrompt(normalizedText)) return "fragment";
    if (explicitQuestions.length === 0 && !extracted) return "fragment";
    return "complete";
  })();

  const anchor: QuestionAnchor =
    answerability === "fragment" && labels.includes("followup") && options?.previousQuestion
      ? "previous_answer"
      : (answerability === "complete" ? "current_window" : "none");

  const questions = (explicitQuestions.length > 0
    ? explicitQuestions
    : (extracted && answerability === "complete" ? [ensureQuestionMark(extracted)] : []))
    .map((question) => {
      const questionLabels = detectPatternLabelsInternal(question);
      return {
        text: question,
        norm: normalizeForDedup(question),
        labels: questionLabels,
        confidence: Math.max(
          detectQuestionAdvanced(question).confidence,
          detect(question, "final").confidence,
          answerability === "complete" ? 0.72 : 0.45,
        ),
        answerability: answerability === "complete" ? "complete" : "fragment",
      } satisfies FramedQuestionItem;
    });

  const confidence = questions.length > 0
    ? Math.max(...questions.map((item) => item.confidence))
    : Math.max(
        detectQuestionAdvanced(rawText).confidence,
        detect(rawText, "final").confidence,
        answerability === "fragment" ? 0.45 : 0,
      );

  return {
    rawText,
    normalizedText,
    labels: Array.from(new Set<QuestionPatternLabel>([
      ...labels,
      ...(questions.length > 1 ? ["multi_question"] as QuestionPatternLabel[] : []),
    ])),
    answerability,
    anchor,
    questions,
    windowHash,
    confidence,
    cleanQuestion: questions[0]?.text || "",
    isQuestion: answerability === "complete" && questions.length > 0,
  };
}

export function resolveActiveQuestionWindow(
  text: string,
  options?: { previousQuestion?: string },
): FramedQuestionResult {
  const base = frameQuestionWindow(text, options);
  if (base.answerability === "complete" && base.questions.length > 0) {
    return base;
  }

  const previousQuestion = String(options?.previousQuestion || "").trim();
  const mergedQuestion = previousQuestion ? mergeFollowupQuestion(previousQuestion, text) : "";
  if (!mergedQuestion) {
    return base;
  }

  const mergedLabels = Array.from(new Set<QuestionPatternLabel>([
    ...base.labels,
    "followup",
  ]));
  const mergedConfidence = Math.max(base.confidence, 0.8);
  return {
    ...base,
    labels: mergedLabels,
    answerability: "complete",
    anchor: "previous_answer",
    questions: [{
      text: mergedQuestion,
      norm: normalizeForDedup(mergedQuestion),
      labels: mergedLabels,
      confidence: mergedConfidence,
      answerability: "complete",
    }],
    confidence: mergedConfidence,
    cleanQuestion: mergedQuestion,
    isQuestion: true,
  };
}
