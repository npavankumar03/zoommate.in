/**
 * useZoommateSocket — Desktop overlay hook.
 *
 * Transport:
 *   - Socket.IO  → transcript events only (recognizing_item, recognized_item, join_meeting)
 *   - WebSocket /ws → answer streaming (same path as the website)
 *
 * Answer flow mirrors the website exactly:
 *   session_start → question → assistant_start / assistant_chunk / assistant_end
 *   + optional refine pass: assistant_refine_start / chunk / end
 *
 * STT: Azure (getUserMedia + AudioContext + AudioWorklet/ScriptProcessor → PushAudioInputStream)
 *      echoCancellation:false first, fallback to true for incompatible drivers
 *      + addSystemAudio() to mix in getDisplayMedia system audio for headphone users
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { bridge } from "../lib/bridge";

const SERVER_URL     = "https://ai.zoommate.in";
const WS_ANSWER_URL  = "wss://ai.zoommate.in/ws";

// ── NLP Question Detection Pipeline (ported from shared/questionDetection.ts) ──

const HYBRID_FOLLOWUP_WINDOW_MS  = 30_000;
const HYBRID_FOLLOWUP_MAX_WORDS  = 8;

const INTERROGATIVE_STARTERS = [
  "what", "why", "how", "when", "where", "who", "which",
  "can", "could", "would", "should", "is", "are", "do", "does", "did",
  "have", "has", "will", "shall", "was", "were", "may", "might",
  "tell", "explain", "describe", "walk",
];

const QUESTION_PHRASES = [
  "tell me about", "tell me", "walk me through", "explain to me", "talk about",
  "give me an example", "what do you think", "what are your thoughts",
  "how would you", "how do you", "how did you", "can you describe", "can you explain",
  "could you tell", "could you explain", "difference between", "what is the difference",
  "why do you", "why did you", "where do you see", "what would you do",
  "what's your", "whats your", "what is your", "describe a time", "give an example",
  "share an experience", "elaborate on", "do you have experience",
  "do you have any experience", "do you have any certifications",
  "have you worked with", "have you used", "have you ever",
  "are you familiar with", "are you comfortable with",
  "what experience do you have", "what tools do you use",
  "what technologies do you", "why are you interested", "why do you want",
  "why should we hire", "what motivates you", "what are your strengths",
  "what are your weaknesses", "what salary", "when can you start",
  "tell us about", "talk us through", "give us an example", "share with us",
  "describe your experience", "describe your role", "what makes you",
  "hit me with", "hit us with", "hit me", "hit us", "go ahead and",
  "let's start with", "lets start with", "start with",
  "your thoughts on", "your opinion on", "your take on", "your approach to",
  "your perspective on", "any experience with", "any experience in",
  "any background in", "any knowledge of", "familiar with", "comfortable with",
  "experience with", "experience in", "background in", "talk me through",
  "talk us through", "share your experience", "share your background",
  "share a time", "thoughts on",
];

const INTERVIEW_INTENT_KEYWORDS = /\b(experience|worked|used|familiar|comfortable|exposure|background|hands on|knowledge|certification|strong in|thoughts?|opinion|approach|perspective|take)\b/i;
const SECOND_PERSON_DECLARATIVE = /^(you\s+(have|got|worked|used|built|implemented|handled|seen|ever|know)|youve\s+(worked|used|built|implemented|handled|seen)|youre\s+(familiar|comfortable)|your\s+(experience|background|role|work|skills?|knowledge|expertise)\s+(with|in|on|at|using|related)|your\s+(thoughts?|opinion|take|approach|perspective|view|understanding)\b)\b/i;

export const INTERVIEW_SIGNAL_RE = /\b(your\s+(thoughts?|opinion|take|approach|perspective|view|understanding)\b|any\s+(experience|background|knowledge|exposure|familiarity|idea)\b|familiar\s+with\b|comfortable\s+with\b|experience\s+(with|in|using|on|of)\b|background\s+(in|with|on)\b|knowledge\s+of\b|exposure\s+to\b|talk\s+(me|us)\s+through\b|share\s+(your|a|an|with)\b|give\s+(me|us)\s+(an?\s+)?(example|idea|sense|overview|insight|walkthrough)\b|thoughts?\s+on\b|opinion\s+on\b|approach\s+to\b|worked?\s+with\b|done\s+any\b)\b/i;

export const STANDALONE_TECH_RE = /\b(react|angular|vue|svelte|nextjs|nuxtjs|gatsby|remix|astro|ember|backbone|jquery|bootstrap|tailwind|tailwindcss|chakra|antd|shadcn|materialui|storybook|nodejs|node|express|fastapi|flask|django|spring|springboot|rails|laravel|aspnet|nestjs|fastify|hapi|koa|gin|echo|fiber|phoenix|sinatra|tornado|sanic|aiohttp|typescript|javascript|python|java|golang|go|rust|kotlin|swift|scala|csharp|cpp|php|ruby|dart|elixir|clojure|haskell|fsharp|julia|perl|lua|bash|powershell|shell|cobol|matlab|postgres|postgresql|mysql|sqlite|mongodb|redis|cassandra|dynamodb|elasticsearch|solr|neo4j|influxdb|cockroachdb|mariadb|oracle|sqlserver|firestore|supabase|planetscale|fauna|couchbase|hbase|aurora|aws|azure|gcp|heroku|vercel|netlify|cloudflare|digitalocean|linode|railway|render|docker|kubernetes|k8s|terraform|ansible|chef|puppet|jenkins|githubactions|gitlabci|circleci|argocd|helm|vagrant|packer|kafka|rabbitmq|sqs|sns|pubsub|nats|zeromq|activemq|celery|tensorflow|pytorch|keras|sklearn|scikit|pandas|numpy|opencv|nltk|spacy|huggingface|langchain|llamaindex|llm|gpt|bert|transformers|xgboost|lightgbm|rag|spark|hadoop|airflow|flink|databricks|snowflake|dbt|looker|tableau|powerbi|redshift|bigquery|hive|presto|trino|graphql|grpc|websocket|rest|restful|http|https|tcp|udp|mqtt|amqp|oauth|jwt|saml|openid|microservices|monolith|serverless|eventdriven|cqrs|ddd|tdd|bdd|git|github|gitlab|bitbucket|jira|confluence|figma|postman|swagger|openapi|webpack|vite|rollup|babel|eslint|prettier|devops|sre|cicd|agile|scrum|kanban|dotnet|blazor|xamarin|unity|wpf|winforms|api|sdk|cli|oop|solid|mvc|mvvm|spa|pwa|ssr|csr|cdn|dns|vpn|ssl|tls|microservice|containerization|orchestration|html|css|sass|less|json|xml|yaml|toml|markdown|linux|ubuntu|debian|centos|macos|unix|stripe|twilio|sendgrid|datadog|sentry|pagerduty|splunk|newrelic|grafana|prometheus|sqlalchemy|alembic|pydantic|nginx|apache|gunicorn|uvicorn|wipro|anthem|tcs|infosys|cognizant|accenture|capgemini|deloitte|ibm|microsoft|google|amazon|meta|apple|netflix|uber|airbnb|backend|frontend|fullstack|devops|sysadmin|architect|engineer|developer|programmer)\b|\.NET\b/i;

function hasSecondPersonDeclarativeQuestionIntent(text: string): boolean {
  return SECOND_PERSON_DECLARATIVE.test(text) && INTERVIEW_INTENT_KEYWORDS.test(text);
}

function hasQuestionPunctuationSignal(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /\?/.test(raw) || /(?:^|[.!]\s+)(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|have|has)\b/i.test(raw);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s?]/g, "").replace(/\s+/g, " ").trim();
}

const FILLER_WORD_RE = /\b(uh+|um+|erm|hmm+|like|you know|sort of|kind of|basically|actually|literally|so|okay|ok)\b/g;
const STOPWORDS = new Set([
  "a","an","the","is","are","am","was","were","be","been","being",
  "do","does","did","to","for","of","in","on","at","by","with",
  "and","or","but","if","then","so","that","this","it","as","from",
  "i","me","my","we","our","you","your","he","she","they","them",
]);

function stripRepeatedFillers(input: string): string {
  return input
    .replace(FILLER_WORD_RE, " ")
    .replace(/\b(\w+)(\s+\1){1,}\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ASR correction rules (ported from shared/questionDetection.ts)
const ASR_FIXES: Array<[RegExp, string]> = [
  [/\band\s+also\b/gi, "and"], [/\bor\s+also\b/gi, "or"],
  [/\balso\s+(in\s+|with\s+)?(?=\w)/gi, "$1"],
  [/\bjango\b/gi, "Django"], [/\bgraph ?ql\b/gi, "GraphQL"],
  [/\bfast ?api?s?\b/gi, "FastAPI"], [/\brest(?:aurant)?\s+apis?\b/gi, "REST APIs"],
  [/\bpy(?:\s+)?spark\b/gi, "PySpark"], [/\bsparks by spark\b/gi, "Spark/PySpark"],
  [/\breact(?:ion)?\s+js\b/gi, "React.js"], [/\breact(?:ion)?\s+native\b/gi, "React Native"],
  [/\bnext(?:\s+)?js\b/gi, "Next.js"], [/\bnode(?:\s+)?js\b/gi, "Node.js"],
  [/\bvue(?:\s+)?js\b/gi, "Vue.js"], [/\bangular(?:\s+)?js\b/gi, "AngularJS"],
  [/\btype(?:\s+)?script\b/gi, "TypeScript"], [/\bjava(?:\s+)?script\b/gi, "JavaScript"],
  [/\bspring(?:\s+)?boot\b/gi, "Spring Boot"], [/\bhybernate\b/gi, "Hibernate"],
  [/\bmy(?:\s+)?sequel\b/gi, "MySQL"], [/\byes(?:\s+)?sequel\b/gi, "MySQL"],
  [/\bmy\s+s\s*q\s*l\b/gi, "MySQL"], [/\bpost(?:\s+)?gres(?:ql)?\b/gi, "PostgreSQL"],
  [/\bpost(?:\s+)?gray(?:s|sql)?\b/gi, "PostgreSQL"], [/\bmongo(?:\s+)?db\b/gi, "MongoDB"],
  [/\belastic(?:\s+)?search\b/gi, "Elasticsearch"],
  [/\bkuber(?:\s+)?net(?:es|is)?\b/gi, "Kubernetes"], [/\bkuberneti[sz]\b/gi, "Kubernetes"],
  [/\bdocker(?:\s+)?file\b/gi, "Dockerfile"], [/\bterraform\b/gi, "Terraform"],
  [/\bjenkins\b/gi, "Jenkins"], [/\bansible\b/gi, "Ansible"],
  [/\bprometheus\b/gi, "Prometheus"], [/\bgrafana\b/gi, "Grafana"],
  [/\bscikit(?:\s+|-)?learn\b/gi, "scikit-learn"], [/\btensor(?:\s+)?flow\b/gi, "TensorFlow"],
  [/\bpy(?:\s+)?torch\b/gi, "PyTorch"], [/\bpie(?:\s+)?torch\b/gi, "PyTorch"],
  [/\blang(?:\s+)?chain\b/gi, "LangChain"], [/\blanguid\b/gi, "LangChain"],
  [/\bopen(?:\s+)?ai\b/gi, "OpenAI"], [/\bhugging(?:\s+)?face\b/gi, "Hugging Face"],
  [/\bnum(?:\s+)?pie\b/gi, "NumPy"], [/\bcellar(?:y)?\b/gi, "Celery"],
  [/\brabbit(?:\s+)?mq\b/gi, "RabbitMQ"], [/\bkafka\b/gi, "Kafka"],
  [/\bair(?:\s+)?flow\b/gi, "Airflow"], [/\bdbt\b/gi, "dbt"],
  [/\bsnow(?:\s+)?flake\b/gi, "Snowflake"], [/\bdatabricks\b/gi, "Databricks"],
  [/\bspark(?:\s+)?sql\b/gi, "Spark SQL"], [/\bharted\b/gi, "Hadoop"],
  [/\baws(?:\s+)?lambda\b/gi, "AWS Lambda"], [/\bec(?:\s+)?2\b/gi, "EC2"],
  [/\bs(?:\s+)?3(?:\s+)?bucket\b/gi, "S3 bucket"], [/\bcloud(?:\s+)?formation\b/gi, "CloudFormation"],
  [/\bcloud\s+front\b/gi, "CloudFront"], [/\bapi(?:\s+)?gateway\b/gi, "API Gateway"],
  [/\bdynamo(?:\s+)?db\b/gi, "DynamoDB"], [/\bgoogle(?:\s+)?cloud(?:\s+)?platform\b/gi, "GCP"],
  [/\bbig(?:\s+)?query\b/gi, "BigQuery"], [/\bazure(?:\s+)?devops\b/gi, "Azure DevOps"],
  [/\bazure(?:\s+)?functions?\b/gi, "Azure Functions"], [/\bpub(?:\s+)?sub\b/gi, "Pub/Sub"],
  [/\bci(?:\s+)?cd\b/gi, "CI/CD"], [/\bcacd\b/gi, "CI/CD"], [/\bcic\s*d\b/gi, "CI/CD"],
  [/\bgit(?:\s+)?lab\b/gi, "GitLab"], [/\bgit(?:\s+)?hub(?:\s+)?actions?\b/gi, "GitHub Actions"],
  [/\bkitab\b/gi, "GitHub"], [/\bgit(?:\s+)?hub\b/gi, "GitHub"],
  [/\bmicro(?:\s+)?services?\b/gi, "microservices"], [/\bserver(?:\s+)?less\b/gi, "serverless"],
  [/\bobject(?:\s+)?oriented\b/gi, "object-oriented"], [/\bsolid(?:\s+)?principles?\b/gi, "SOLID principles"],
  [/\bdependency(?:\s+)?inject\w+\b/gi, "dependency injection"],
  [/\btest(?:\s+)?driven(?:\s+)?development\b/gi, "TDD"],
  [/\bmachine(?:\s+)?learning\b/gi, "machine learning"], [/\bdeep(?:\s+)?learning\b/gi, "deep learning"],
  [/\bnatural(?:\s+)?language(?:\s+)?processing\b/gi, "NLP"],
  [/\blarge(?:\s+)?language(?:\s+)?model\b/gi, "LLM"],
  [/\bretrieval(?:\s+)?augmented\b/gi, "retrieval-augmented"],
  [/\bfine(?:\s+)?tun\w+\b/gi, "fine-tuning"], [/\bvector(?:\s+)?database\b/gi, "vector database"],
  [/\bpin(?:\s+)?cone\b/gi, "Pinecone"], [/\bno(?:\s+)?sql\b/gi, "NoSQL"],
  [/\bjson(?:\s+)?web(?:\s+)?token\b/gi, "JWT"], [/\boath\b/gi, "OAuth"],
  [/\bsalary\b/gi, "Celery"], [/\bsillary\b/gi, "Celery"],
  [/\bsel(?:e|a)ry\b/gi, "Celery"], [/\bsell(?:e|a)ry\b/gi, "Celery"],
  [/\bjinkins\b/gi, "Jenkins"], [/\bjankins\b/gi, "Jenkins"],
  [/\bjenkin\b/gi, "Jenkins"], [/\bjinkin\b/gi, "Jenkins"],
  [/\bantible\b/gi, "Ansible"], [/\bansibel\b/gi, "Ansible"],
  [/\bancible\b/gi, "Ansible"], [/\buncible\b/gi, "Ansible"], [/\bansibull\b/gi, "Ansible"],
  [/\btera\s*form\b/gi, "Terraform"], [/\btear\s*a\s*form\b/gi, "Terraform"],
  [/\btear\s*form\b/gi, "Terraform"], [/\bterra\s*farm\b/gi, "Terraform"],
  [/\bterriform\b/gi, "Terraform"],
  [/\bwoo\s*js\b/gi, "Vue.js"], [/\bview\s*js\b/gi, "Vue.js"],
  [/\bvee\s*js\b/gi, "Vue.js"], [/\bwue\s*js\b/gi, "Vue.js"],
  [/\bwoo\b(?=\s+(framework|component|frontend|router))/gi, "Vue"],
  [/\bal\s*gore\s*(?:rhythm|ithm|rithm)\b/gi, "algorithm"],
  [/\balgo\s*rism\b/gi, "algorithm"], [/\balgor(?:hythm|hism)\b/gi, "algorithm"],
  [/\bmavin\b/gi, "Maven"], [/\bmaben\b/gi, "Maven"], [/\bmayvn\b/gi, "Maven"],
  [/\bgradel\b/gi, "Gradle"], [/\bgraydel\b/gi, "Gradle"], [/\bgrade\s*l\b/gi, "Gradle"],
  [/\bjew\s*pit(?:er|a)\b/gi, "Jupyter"], [/\bjupiter\s*notebook\b/gi, "Jupyter Notebook"],
  [/\banna\s*conda\b/gi, "Anaconda"], [/\bpie\s*charm\b/gi, "PyCharm"],
  [/\bpie\s*test\b/gi, "pytest"], [/\bpee\s*test\b/gi, "pytest"],
  [/\bintel(?:\s+)?i\s*j\b/gi, "IntelliJ"], [/\bintelect\s*j\b/gi, "IntelliJ"],
  [/\bpost\s*man\b/gi, "Postman"], [/\bbit\s*bucket\b/gi, "Bitbucket"],
  [/\bji\s*ra\b/gi, "Jira"], [/\bconfluens\b/gi, "Confluence"],
  [/\bvs\s*code\b/gi, "VS Code"], [/\bvisual\s*studio\s*code\b/gi, "VS Code"],
  [/\bdreading\b(?=.*(?:thread|concurren|async|parallel))/gi, "threading"],
  [/\bdroughput\b/gi, "throughput"], [/\bdrewput\b/gi, "throughput"],
  [/\bdrottle\b/gi, "throttle"], [/\bthrough\s*put\b/gi, "throughput"],
  [/\bwersion\b/gi, "version"], [/\bwariable\b/gi, "variable"],
  [/\binwoke\b/gi, "invoke"], [/\bwalid\b/gi, "valid"],
  [/\bwalidation\b/gi, "validation"], [/\bwalidate\b/gi, "validate"],
  [/\bwalidating\b/gi, "validating"], [/\bwirtual\b/gi, "virtual"],
  [/\bwulnerabilit\w+\b/gi, "vulnerability"],
  [/\bdev\s*ops\b/gi, "DevOps"], [/\bdebloy\b/gi, "deploy"],
  [/\bdebloyment\b/gi, "deployment"], [/\bdebloyed\b/gi, "deployed"],
  [/\bdebloying\b/gi, "deploying"], [/\bskrum\b/gi, "Scrum"],
  [/\bkanvan\b/gi, "Kanban"], [/\bkan\s*ban\b/gi, "Kanban"],
  [/\bi\s*am\s*role\b/gi, "IAM role"], [/\biam\s*role\b/gi, "IAM role"],
  [/\bs\s*q\s*s\b/gi, "SQS"], [/\bs\s*n\s*s\b/gi, "SNS"],
  [/\bcloud\s*watch\b/gi, "CloudWatch"], [/\bload\s*balance[rd]?\b/gi, "load balancer"],
  [/\bauto\s*scaling\b/gi, "auto scaling"], [/\belas(?:tic)?\s*cache\b/gi, "ElastiCache"],
  [/\brds\b/gi, "RDS"], [/\baurora\s*(?:db)?\b/gi, "Aurora"],
  [/\bfootstep development\b/gi, "full stack development"],
  [/\bfood(?:\s+)?stack\b/gi, "full stack"], [/\bfoot(?:\s+)?stack\b/gi, "full stack"],
  [/\baid driven\b/gi, "AI-driven"], [/\bair driven\b/gi, "AI-driven"],
  [/\bfire\s*base\b/gi, "Firebase"], [/\bweb\s*pack\b/gi, "Webpack"], [/\bveet\b/gi, "Vite"],
  [/\bpost\s*grease\s*(?:ql|cul|kul|cool)?\b/gi, "PostgreSQL"],
  [/\bpost\s*gre\s*sequel\b/gi, "PostgreSQL"],
  [/\bpost\s*(?:gress|grace|greys|graze)\b/gi, "PostgreSQL"],
  [/\bpastor\s*(?:gres|grace|greys)?\b/gi, "PostgreSQL"],
  [/\bgraph\s*(?:cue\s*l|cul|cool|kul|queue\s*l)\b/gi, "GraphQL"],
  [/\bgraph\s*q\s*l\b/gi, "GraphQL"], [/\bkubernete?[sz]\b/gi, "Kubernetes"],
  [/\bkoo\s*ber\s*net(?:es|is|ez)?\b/gi, "Kubernetes"], [/\bk8s\b/gi, "Kubernetes"],
  [/\bdyna\s*mo\s*(?:db|d\s*b|database)\b/gi, "DynamoDB"],
  [/\bdynamo\s*d\s*b\b/gi, "DynamoDB"], [/\bredis\b/gi, "Redis"],
  [/\bread\s*is\b/gi, "Redis"], [/\bcaf\s*ka\b/gi, "Kafka"],
  [/\bre\s*dux\b/gi, "Redux"], [/\breact\s*redux\b/gi, "React Redux"],
  [/\bdocker\s*compose\b/gi, "Docker Compose"], [/\bkubectl\b/gi, "kubectl"],
  [/\bkube\s*ctl\b/gi, "kubectl"], [/\bjunit\b/gi, "JUnit"],
  [/\bpytest\b/gi, "pytest"], [/\bnginx\b/gi, "Nginx"],
  [/\ben\s*jinx\b/gi, "Nginx"], [/\beng\s*inx\b/gi, "Nginx"],
  [/\bhas\s*kell\b/gi, "Haskell"], [/\brust(?:\s+lang(?:uage)?)?\b/gi, "Rust"],
  [/\bgolang\b/gi, "Go"], [/\bgo\s+lang(?:uage)?\b/gi, "Go"],
  [/\bsql\s*alchemy\b/gi, "SQLAlchemy"], [/\bpydantic\b/gi, "Pydantic"],
  [/\bfastify\b/gi, "Fastify"], [/\bexpress(?:\s+js)?\b/gi, "Express.js"],
  [/\bsocket\s*\.?\s*io\b/gi, "Socket.IO"], [/\bweb\s*socket\b/gi, "WebSocket"],
  [/\bopen\s*id\b/gi, "OpenID"], [/\bjson\s*web\s*token\b/gi, "JWT"],
  [/\bsaw\s*ml\b/gi, "SAML"], [/\bld\s*ap\b/gi, "LDAP"],
  [/\bdot\s*net\b/gi, ".NET"], [/\basp\s*dot\s*net\b/gi, "ASP.NET"],
  [/\basp\s*net\b/gi, "ASP.NET"], [/\bc\s*sharp\b/gi, "C#"],
  [/\bc\s*plus\s*plus\b/gi, "C++"], [/\bsee\s*sharp\b/gi, "C#"],
  [/\bsee\s*plus\s*plus\b/gi, "C++"], [/\bdot\s*net\s*core\b/gi, ".NET Core"],
  [/\bentity\s*framework\b/gi, "Entity Framework"], [/\blazor\b/gi, "Blazor"],
  [/\bxaml\b/gi, "XAML"], [/\bnuget\b/gi, "NuGet"],
  [/\bwhere did you worked\b/gi, "Where did you work"],
  [/\bwhere do you work recently\b/gi, "Where do you work currently"],
  [/\btell me about you\b/gi, "Tell me about yourself"],
  [/\bcan you explain me\b/gi, "Can you explain"], [/\bexplain me\b/gi, "explain"],
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

function applyAsrCorrections(raw: string): string {
  let text = (raw || "").replace(/\s+/g, " ").trim();
  if (!text) return text;
  for (const [re, to] of ASR_FIXES) text = text.replace(re, to);
  for (const rule of ASR_CONTEXTUAL_FIXES) {
    if (rule.when.test(text)) text = text.replace(rule.re, rule.to);
  }
  return text;
}

function detectQuestionAdvanced(text: string): { isQuestion: boolean; confidence: number; type: "direct" | "indirect" | "command" | "unknown" } {
  const raw = (text || "").toLowerCase().trim();
  if (!raw) return { isQuestion: false, confidence: 0, type: "unknown" };
  const normalized = stripRepeatedFillers(raw).replace(/\s+/g, " ").trim();
  const words = normalized.split(" ").filter(Boolean);
  const startsWh = /^(what|why|how|when|where|who|which)\b/.test(normalized);
  const startsInterrogative = /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/.test(normalized);
  const startsCommand = /^(explain|tell me|tell us|walk me|walk us|describe|share|give me|give us|talk me through|talk us through|your experience|your thoughts|your opinion|your take|your approach|any experience|familiar with|comfortable with|experience with|experience in|have you|are you familiar|are you comfortable)/.test(normalized);
  let score = 0;
  if (/[?]\s*$/.test(normalized)) score += 0.5;
  if (startsInterrogative) score += 0.5;
  if (startsCommand) score += 0.4;
  if (startsInterrogative && words.length >= 3) score += 0.15;
  if (startsWh && words.length >= 4) score += 0.25;
  if (startsWh && words.length >= 3) score += 0.15;
  if (/\b(difference between|walk me through|tell me about|explain|what happens if|how would you)\b/.test(normalized)) score += 0.5;
  if (/\b(do you have experience|have you worked with|have you used|have you ever|are you familiar with|are you comfortable with|what was your|when did you|can you share|could you share|your experience with|your background in|your experience in|describe a time|give me an example|give an example|your thoughts on|your opinion on|your take on|your approach to|any experience with|any experience in|familiar with|comfortable with|thoughts on)\b/.test(normalized)) score += 0.35;
  if (STANDALONE_TECH_RE.test(normalized) && words.length <= 5) score += 0.3;
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

/** Full NLP question detector — ported from shared/questionDetection.ts */
function detectQuestion(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const advanced = detectQuestionAdvanced(text);
  if (advanced.isQuestion) return true;
  const normalized = normalizeText(text);
  const words = normalized.split(" ").filter(Boolean);
  const firstWord = words[0] || "";
  const twoWord = words.slice(0, 2).join(" ");
  const shortOneWordInterrogatives = new Set(["why","how","what","which","who","when","where","elaborate","explain","continue","more","next","expand","clarify","proceed","further","detail","summarize","example"]);
  const shortTwoWordQuestions = new Set(["how come","what else","why not","which one","how so","what now","who else","what next","which way","what for","who now","show me","keep going","go on","go ahead","say more","dive deeper","dig deeper","break down","zoom in","one more","and then"]);
  if (normalized.endsWith("?")) return true;
  if (words.length === 1 && shortOneWordInterrogatives.has(firstWord)) return true;
  if (words.length === 2 && shortTwoWordQuestions.has(twoWord)) return true;
  for (const phrase of QUESTION_PHRASES) {
    if (normalized.includes(phrase)) return true;
  }
  const auxVerbs = ["have","has","was","were","is","are","do","does","did","will","shall","may","might","can","could","would","should"];
  if (INTERROGATIVE_STARTERS.includes(firstWord)) {
    if (words.length >= 3) {
      if (auxVerbs.includes(firstWord)) {
        const secondWord = words[1] || "";
        const subjectWords = ["you","your","we","they","i","he","she","it","there","anyone","someone"];
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
  if (INTERVIEW_SIGNAL_RE.test(normalized)) return true;
  if (words.length <= 5 && STANDALONE_TECH_RE.test(normalized)) return true;
  return false;
}

function normalizeForDedup(text: string): string {
  return normalizeText(text)
    .replace(/\?/g, "")
    .replace(/\b(um|uh|like|you know|so|well|basically|actually|right)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same noise filter as website's isLikelyNoiseSegment */
function isLikelyNoiseSegment(raw: string): boolean {
  const text = String(raw || "").trim();
  if (!text) return true;
  const normalized = text.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(" ").filter(Boolean);
  const hasQuestionCue =
    /\?/.test(text) ||
    /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/.test(normalized);
  const hasInterviewCue =
    /\b(interview|experience|react|python|fastapi|fast api|fast apis|apis|flask|django|api|backend|frontend|project|worked)\b/.test(normalized);
  if (words.length <= 1) return !(hasInterviewCue || hasQuestionCue);
  if (/\b(hey cortana|open internet explorer|call mom|call dad|play music|download)\b/.test(normalized)) return true;
  if (/^(okay|ok|right|yeah|yes|no|hmm|uh|um|uh huh|so|and also|also)\b/.test(normalized) && words.length <= 4) return true;
  if (!hasInterviewCue && !hasQuestionCue && words.length <= 3) return true;
  if (!hasInterviewCue && !hasQuestionCue && words.length <= 10) {
    const hasVerb = /\b(is|are|was|were|be|been|have|has|had|do|does|did|get|got|make|made|use|used|work|worked|know|knew|think|thought|say|said|see|saw|build|built|write|wrote|run|ran|implement|deploy|design|develop|create|handle|manage|integrate|configure|test|debug)\b/i.test(normalized);
    const hasSubjectPronoun = /\b(i|we|you|they|he|she|it|my|our|your|their|this|that|these|those)\b/i.test(normalized);
    const hasTechSignal = /\b(api|sdk|cloud|server|client|database|db|code|app|service|system|platform|tool|stack|framework|library|module|function|class|object|method|query|request|response|endpoint|deploy|build|test|debug|pipeline|repo|git|docker|ci|cd|ml|ai|model|data|stream|queue|event|token|auth|role|schema|table|index|cache|session|jwt|oauth)\b/i.test(normalized);
    if (!hasVerb && !hasSubjectPronoun && !hasTechSignal) return true;
  }
  return false;
}

/** Same as website's isLikelyIncompleteFragment */
function isLikelyIncompleteFragment(raw: string): boolean {
  const text = String(raw || "").trim();
  if (!text) return true;
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(" ").filter(Boolean);
  if (words.length <= 3) return true;
  if (/\?$/.test(text)) return false;
  if (words.length <= 6 && /\b(in|on|for|with|about|to|from|and|or|also)\s*$/.test(normalized)) return true;
  return false;
}

/** Mirrors website's maybeWrapHybridFollowups() — conservative version (resolveEnterSeed) */
function maybeWrapHybridFollowups(
  baseQuestion: string,
  memory: Array<{ text: string; answered: boolean; ts: number }>,
): { seedText: string; displayQuestion: string; multiQuestionMode: true } | null {
  if (!baseQuestion) return null;
  const now      = Date.now();
  const baseNorm = normalizeForDedup(baseQuestion);

  const followups = memory
    .filter((q) => !q.answered && (now - q.ts) <= HYBRID_FOLLOWUP_WINDOW_MS)
    .map((q) => q.text)
    .filter((q) => normalizeForDedup(q) !== baseNorm)
    .filter((q) => !isLikelyNoiseSegment(q))
    .filter((q) => {
      const norm = q.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const wc   = norm.split(/\s+/).filter(Boolean).length;
      // Match website's conservative version: wc >= 2, max 6 words
      if (wc < 2 || wc > Math.min(6, HYBRID_FOLLOWUP_MAX_WORDS)) return false;
      const explicitQuestion = norm.endsWith("?") || /^(what about|why|how|what|which|where|when|who)\b/i.test(norm);
      const cleanJoinerTopic = /^(and also|and|also|plus|in addition)\b/i.test(norm)
        && STANDALONE_TECH_RE.test(q.replace(/^(and also|and|also|plus|in addition)\s+/i, "").trim());
      return explicitQuestion || cleanJoinerTopic;
    });

  // Dedup
  const deduped: string[] = [];
  for (const f of followups) {
    const key = normalizeForDedup(f);
    if (!key) continue;
    if (deduped.find((x) => normalizeForDedup(x) === key)) continue;
    deduped.push(f);
  }
  if (!deduped.length) return null;
  // Match website: only allow ONE follow-up (conservative)
  if (deduped.length > 1) return null;

  const questions = [baseQuestion, ...deduped];
  const seedText  = [
    "Interviewer asked a main question with short follow-ups within the last 30 seconds.",
    "Answer all of them in order using one response.",
    "Questions:",
    ...questions,
  ].join("\n");

  return { seedText, displayQuestion: questions.join("\n"), multiQuestionMode: true };
}

/** Same as website's resolveFormat() — auto-detects code questions */
function resolveFormat(text: string): string {
  const isCodeQ = /\b(write|build|create|implement|code|program|script|function|class|algorithm|example code|show code|give code|generate code|without (using )?function|without function|in python|in javascript|in typescript|in java|in golang|in go|in rust|in c\+\+|in c#|using (fastapi|django|flask|express|react|node))\b/i.test(text);
  return isCodeQ ? "code_example" : "concise";
}

// ── Question cleaning & dedup (ported from meeting-session.tsx) ───────────────

/** Deduplicate repeated words + remove gibberish tokens from ASR output */
function cleanAsrNoise(raw: string): string {
  let text = (raw || "").replace(/\s+/g, " ").trim();
  if (!text) return text;

  // Collapse consecutive duplicate words ("Flask Flask" → "Flask")
  const tokens = text.split(" ");
  const out: string[] = [];
  for (const w of tokens) {
    if (out.length && out[out.length - 1].toLowerCase() === w.toLowerCase()) continue;
    out.push(w);
  }
  text = out.join(" ");

  // Keep only word-like tokens (allows tech terms, punctuation in tech names)
  const TECH_TOKEN = /^(react|redux|python|django|flask|fastapi|node|nodejs|typescript|javascript|java|golang|kotlin|rust|api|apis|sql|nosql|postgres|postgresql|mysql|mongodb|redis|aws|azure|gcp|docker|kubernetes|k8s|graphql|rest|restful|jwt|oauth|cicd|terraform|jenkins|ansible|kafka|rabbitmq|celery|airflow|spark|pyspark|hadoop|snowflake|databricks|dbt|pandas|numpy|pytorch|tensorflow|sklearn|langchain|openai|llm|rag|nlp|ml|ai|elasticsearch|nginx|grpc|websocket|microservices|serverless|nextjs|nestjs|vuejs|angular|svelte|webpack|vite|jest|pytest|junit|maven|gradle|helm|prometheus|grafana|firebase|supabase|prisma|drizzle|sequelize|typeorm|hibernate|springboot|fastify|express)$/i;
  const isWordLike = (t: string): boolean => {
    const core = t.toLowerCase().replace(/^[^a-z0-9.+#/-]+|[^a-z0-9.+#/-]+$/gi, "");
    if (!core) return false;
    if (TECH_TOKEN.test(core)) return true;
    if (/^\d+$/.test(core)) return true;
    if (/^[a-z]{2,}(?:['-][a-z]{2,})?$/i.test(core)) return true;
    if (/^[a-z][a-z0-9]{2,}$/i.test(core)) return true;
    return false;
  };
  text = text.split(" ").filter(isWordLike).join(" ").trim();
  if (!text) return "";

  return text
    .replace(/\bback end\b/gi, "backend")
    .replace(/\bfront end\b/gi, "frontend")
    .replace(/\s+([?.!,])/g, "$1")
    .trim();
}

/** Clean filler prefixes, normalize repeated joiners, ensure question mark */
function sanitizeQuestionCandidate(raw: string): string {
  let text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.replace(/^(please|kindly|uh[\s-]*huh|uh|um|like|you know)\s+/i, "");
  text = text.replace(/^so\s+(?=(FastAPI|React|Python|Django|Flask|JavaScript|TypeScript|Node\.js|AWS|Azure|GCP|Docker|Kubernetes|GraphQL|MongoDB|PostgreSQL|Redis|Kafka|Spring|Angular|Vue)\b)/i, "");
  text = text.replace(/\b(uh[\s-]*huh|uh+|umm+|mmm+|hmm+|ah+|oh+)\b/gi, " ");
  // Collapse repeated words
  text = text
    .replace(/\b(\w+)(?:\s+\1){1,}\b/gi, "$1")
    .replace(/\b((?:\w+\s+){1,4}\w+)\s+\1\b/gi, "$1");
  // Normalize joiners
  text = text
    .replace(/\bandalso\b/gi, "and also")
    .replace(/\b(and also)(?:\s+\1)+\b/gi, "and also")
    .replace(/\b(and)(?:\s+and)+\b/gi, "and")
    .replace(/\b(also)(?:\s+also)+\b/gi, "also")
    .replace(/\b(?:and also|and|also)(?:\s+(?:and also|and|also))+\b/gi, " and also ");
  // Trim trailing joiners
  text = text.replace(/\b(and also|and|also)\b\s*$/i, "").trim();
  text = text.replace(/\s+/g, " ").trim();
  // Add question mark if looks like a question
  if (text && /^(can|could|would|will|do|does|did|is|are|what|why|how|where|when|who|explain|describe|tell|write|show|give)\b/i.test(text)) {
    if (!/[?.!]$/.test(text)) text = `${text}?`;
  }
  return text;
}

/** Levenshtein distance for duplicate detection */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function levenshteinSimilarity(a: string, b: string): number {
  const l = (a || "").trim(), r = (b || "").trim();
  if (!l && !r) return 1;
  if (!l || !r) return 0;
  return 1 - levenshteinDistance(l, r) / Math.max(l.length, r.length);
}

function normalizeQuestionForSimilarity(text: string): string {
  return (text || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter((w) => w.length > 0 && !STOPWORDS.has(w)).join(" ");
}

/** Score-ranked question picker from segments (same as website's pickBestRecentQuestionSeed) */
function pickBestRecentQuestionSeed(segments: string[]): string {
  const items = (segments || []).map((s, idx) => ({ text: String(s || "").trim(), idx })).filter((x) => !!x.text);
  if (!items.length) return "";
  let best = ""; let bestScore = -1e9;
  for (const { text, idx } of items) {
    if (isLikelyNoiseSegment(text)) continue;
    const normalized = text.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
    const words = normalized.split(" ").filter(Boolean);
    const hasQMark = text.includes("?");
    const startsLikeQuestion = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|tell|walk|explain)\b/.test(normalized);
    const hasInterviewCue = /\b(experience|react|python|fastapi|flask|django|api|backend|frontend|project|worked)\b/.test(normalized);
    const partialStub = /^(when did you|do you have|what was your|have you worked with|tell me about)\s*$/.test(normalized);
    const questionLike = hasQMark || startsLikeQuestion || (hasInterviewCue && words.length >= 4);
    if (!questionLike) continue;
    let score = 0;
    score += (100 - idx * 3);
    score += hasQMark ? 60 : 0;
    score += startsLikeQuestion ? 35 : 0;
    score += hasInterviewCue ? 30 : 0;
    score += Math.min(words.length, 22);
    score -= partialStub ? 120 : 0;
    score -= words.length <= 2 ? 70 : 0;
    if (score > bestScore) { bestScore = score; best = text; }
  }
  return best;
}

/** Extract all question parts from segment list (same as website's extractAnyQuestionCandidates) */
function extractAnyQuestionCandidates(segments: string[]): string[] {
  const STARTER_SPLIT = /(?=\b(?:what|why|how|when|where|who|which|do you|have you|can you|could you|would you|are you|is there|tell me about|walk me through|explain)\b)/gi;
  const ordered = [...(segments || [])].reverse();
  const out: string[] = []; const seen = new Set<string>();
  for (const raw of ordered) {
    const line = String(raw || "").trim();
    if (!line) continue;
    const parts = line.includes("?")
      ? line.split("?").map((p) => p.trim()).filter(Boolean).map((p) => `${p}?`)
      : line.split(STARTER_SPLIT).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const clean = part.replace(/^interviewer\s*:\s*/i, "").trim();
      if (!clean || isLikelyNoiseSegment(clean)) continue;
      const normalized = clean.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
      const words = normalized.split(" ").filter(Boolean);
      const firstPerson = /\b(i|my|we|our)\b/.test(normalized) && /\b(have|worked|built|developed|implemented)\b/.test(normalized);
      const overLong = words.length > 30 && !clean.includes("?");
      const looksQuestion = clean.includes("?") || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are|tell|explain|walk)\b/i.test(normalized);
      const advanced = detectQuestionAdvanced(clean);
      const hasInterviewCue = /\b(experience|react|python|fastapi|flask|django|api|backend|frontend|worked)\b/i.test(normalized);
      const partialStub = /^(when did you|do you have|what was your|have you worked with|tell me about|experience in)\s*$/i.test(normalized);
      const highQuality = looksQuestion && words.length >= 1 && (advanced.confidence >= 0.5 || hasInterviewCue || /^(what|why|how|when|where|who|which|do|does|did|can|could|would|have|has|is|are)\b/i.test(normalized));
      if (!highQuality || partialStub || firstPerson || overLong) continue;
      const key = normalizeForDedup(clean);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
  }
  return out.slice(-6);
}

// ── isFollowUp (ported from shared/followup.ts) ────────────────────────────────

const STRONG_FOLLOWUPS = new Set([
  "why", "how", "how so", "what about that", "can you expand",
  "tell me more", "go deeper", "elaborate", "explain that", "explain more",
  "what do you mean", "and then", "what next",
]);

const FOLLOWUP_CUE_RE = /\b(explain|explain more|tell me more|go deeper|elaborate|expand|dig deeper|what do you mean|what about that|about that|about it|how so|why|and then|what next|you said|you mentioned|you told|you just said|you just mentioned|as you said|earlier you|what was that|what did you mean|what did you say)\b/i;

const COREF_TERMS = new Set([
  "that","this","it","those","they","he","she","there","then",
  "same","said","mentioned","earlier",
]);

const CODE_TRANSITION_RE = /\boptimi[sz]e?\b|\bfaster\b|\bmore\s+efficient\b|\bthread.?safe\b|\bconcurrent\b|\bin.?place\b|O\(1\)\s*space|\brefactor\b|\bclean\s+(?:this|it)\s+up\b|\biterative\b|\bwithout\s+recursion\b|\btest\s+cases?\b|\bhow\s+(?:would|do)\s+(?:you|we)\s+test\b|\bunit\s+tests?\b|\bscale\s+this\b|\bproduction.?ready\b|\bdifferent\s+approach\b|\banother\s+way\b|\balternative\b|\btime\s+complexity\b|\bbig.?o\b|\bwhat.?s\s+the\s+complexity\b|\b(?:in|using)\s+(?:python|java(?!script)|golang?|typescript|javascript|c\+\+|c#|rust|kotlin)\b/i;

function _tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function _hasConcreteNounPhrase(tokens: string[]): boolean {
  const nonStop = tokens.filter((t) => t.length >= 4 && !COREF_TERMS.has(t) && !STOPWORDS.has(t));
  return nonStop.length >= 2;
}

function isFollowUp(q: string): { isFollowUp: boolean; confidence: number } {
  const raw = String(q || "").trim();
  if (!raw) return { isFollowUp: false, confidence: 0 };
  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = _tokenize(raw);
  let confidence = 0;

  if (STRONG_FOLLOWUPS.has(normalized) || FOLLOWUP_CUE_RE.test(normalized)) {
    confidence = 0.9;
  }

  const hasCoref = tokens.some((t) => COREF_TERMS.has(t));
  const startsFirstPerson = /^i\b/i.test(normalized);
  const startsWithContinuation = /^(and\b|also\b|but\b|what about\b|how about\b|or\b|plus\b)/i.test(normalized);
  if (!confidence && tokens.length <= 8 && !_hasConcreteNounPhrase(tokens) && !startsFirstPerson) {
    if (hasCoref || startsWithContinuation) confidence = 0.72;
  }
  if (hasCoref) confidence = Math.max(confidence, 0.68);

  // Code-state transitions are always follow-ups
  if (CODE_TRANSITION_RE.test(raw)) confidence = Math.max(confidence, 0.85);

  return { isFollowUp: confidence >= 0.65, confidence };
}

// ── State shape ────────────────────────────────────────────────────────────────

export interface OverlayState {
  transcript:           string;
  finalTranscript:      string;
  transcriptSegments:   string[];
  question:             string;
  answer:               string;
  isStreaming:          boolean;
  isAwaitingFirstChunk: boolean;
  isPaused:             boolean;
  statusLabel: "READY" | "THINKING" | "ANSWERING" | "PAUSED";
  sttError:             string;
  connected:            boolean;   // answer WebSocket
  systemAudioConnected: boolean;
}

const DEFAULT: OverlayState = {
  transcript:           "",
  finalTranscript:      "",
  transcriptSegments:   [],
  question:             "",
  answer:               "",
  isStreaming:          false,
  isAwaitingFirstChunk: false,
  isPaused:             false,
  statusLabel:          "READY",
  sttError:             "",
  connected:            false,
  systemAudioConnected: false,
};

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useZoommateSocket(meetingId: string) {
  const [state, setState] = useState<OverlayState>(DEFAULT);

  const socketRef      = useRef<Socket | null>(null);        // Socket.IO (transcript only)
  const wsAnswerRef    = useRef<WebSocket | null>(null);     // /ws (answers)
  const recognizerRef  = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const pausedRef      = useRef(false);
  const destroyedRef   = useRef(false);
  const streamBufRef   = useRef("");                          // accumulates answer chunks
  const activeReqRef   = useRef("");                          // current requestId

  // Latest-value refs — avoids stale closures in callbacks
  const finalTranscriptRef   = useRef("");
  const transcriptRef        = useRef("");
  const transcriptSegsRef    = useRef<string[]>([]);
  const lastQuestionRef      = useRef("");   // last question sent (for follow-up context)
  const lastAnswerRef        = useRef("");   // last AI answer (for recentSpokenReply)
  // Q&A conversation history for better follow-up context (last 5 pairs)
  const qaHistoryRef = useRef<Array<{ q: string; a: string }>>([]);

  // Interviewer question memory — same as website's interviewerQuestionMemoryRef
  const questionMemoryRef = useRef<Array<{ text: string; answered: boolean; ts: number }>>([]);

  // Streaming state ref — readable from STT callbacks without stale closure
  const isStreamingRef     = useRef(false);
  const bargeInDoneRef     = useRef(false);   // prevent double-cancel per answer
  const lastSegmentTsRef   = useRef(0);        // timestamp of last committed segment (for fragment stitching)

  // Duplicate suppression — prevent re-sending near-identical questions
  const recentAskedFingerprintsRef = useRef<string[]>([]);
  const lastSentQuestionNormRef    = useRef("");

  // STT audio refs — exposed so addSystemAudio() can plug into live AudioContext
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const mixDestRef     = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sysStreamRef   = useRef<MediaStream | null>(null);

  // Azure credentials stored so addSystemAudio can create its own recognizer
  const azureTokenRef  = useRef("");
  const azureRegionRef = useRef("");
  // Separate recognizer for system audio (interviewer)
  const interviewerRecognizerRef = useRef<any>(null);

  // ── Socket.IO — transcript buffer only ────────────────────────────────────
  useEffect(() => {
    if (!meetingId) return;

    const socket = io(SERVER_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on("connect",    () => socket.emit("join_meeting", { meetingId }));
    socket.on("disconnect", () => {});

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [meetingId]);

  // ── Answer WebSocket (/ws) — same path as website ─────────────────────────
  useEffect(() => {
    if (!meetingId) return;
    destroyedRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;

    function connect() {
      if (destroyedRef.current) return;
      const ws = new WebSocket(WS_ANSWER_URL);
      wsAnswerRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts = 0;
        setState((s) => ({ ...s, connected: true }));
        ws.send(JSON.stringify({ type: "session_start", sessionId: meetingId }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data || "{}"));
          // Ignore messages for other sessions
          if (msg.sessionId && msg.sessionId !== meetingId) return;

          switch (msg.type) {
            case "session_started":
              break;

            case "assistant_start":
              activeReqRef.current = String(msg.requestId || "");
              streamBufRef.current = "";
              isStreamingRef.current = true;
              bargeInDoneRef.current = false;
              setState((s) => ({
                ...s,
                isStreaming:          true,
                isAwaitingFirstChunk: true,
                statusLabel:          "ANSWERING",
              }));
              break;

            case "assistant_chunk": {
              if (msg.requestId && msg.requestId !== activeReqRef.current) break;
              const text = String(msg.text || "");
              streamBufRef.current += text;
              setState((s) => ({
                ...s,
                answer:               s.answer + text,
                isAwaitingFirstChunk: false,
              }));
              break;
            }

            case "assistant_end":
              if (msg.requestId && msg.requestId !== activeReqRef.current) break;
              // Store final answer for recentSpokenReply context in follow-ups
              lastAnswerRef.current = streamBufRef.current.slice(0, 800);
              // Push to Q&A history for conversation memory
              if (lastQuestionRef.current && streamBufRef.current) {
                qaHistoryRef.current = [
                  ...qaHistoryRef.current,
                  { q: lastQuestionRef.current.slice(0, 300), a: streamBufRef.current.slice(0, 600) },
                ].slice(-5);
              }
              isStreamingRef.current = false;
              setState((s) => ({
                ...s,
                isStreaming:          false,
                isAwaitingFirstChunk: false,
                statusLabel:          "READY",
              }));
              break;

            // Refine pass — replace answer in-place (same as website)
            case "assistant_refine_start":
              if (msg.requestId && msg.requestId !== `${activeReqRef.current}-r`) break;
              streamBufRef.current = "";
              break;

            case "assistant_refine_chunk": {
              const text = String(msg.text || "");
              streamBufRef.current += text;
              setState((s) => ({ ...s, answer: streamBufRef.current }));
              break;
            }

            case "assistant_refine_end":
              // Update lastAnswer with the refined version
              lastAnswerRef.current = streamBufRef.current.slice(0, 800);
              if (qaHistoryRef.current.length > 0) {
                qaHistoryRef.current[qaHistoryRef.current.length - 1].a = streamBufRef.current.slice(0, 600);
              }
              isStreamingRef.current = false;
              setState((s) => ({ ...s, isStreaming: false, statusLabel: "READY" }));
              break;

            case "error":
              isStreamingRef.current = false;
              setState((s) => ({
                ...s,
                isStreaming:          false,
                isAwaitingFirstChunk: false,
                statusLabel:          "READY",
                answer:               s.answer || `Error: ${msg.message || "Unknown error"}`,
              }));
              break;

            // debug_meta and structured_response — acknowledged, not rendered
            case "debug_meta":
            case "structured_response":
              break;
          }
        } catch {}
      };

      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!destroyedRef.current && reconnectAttempts < 10) {
          reconnectAttempts++;
          reconnectTimer = setTimeout(connect, Math.min(1000 * reconnectAttempts, 8000));
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror — reconnect handled there
      };
    }

    connect();

    return () => {
      destroyedRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsAnswerRef.current) {
        wsAnswerRef.current.close();
        wsAnswerRef.current = null;
      }
    };
  }, [meetingId]);

  // ── Azure STT ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!meetingId) return;

    let mic:        MediaStream  | null = null;
    let pushStream: SpeechSDK.PushAudioInputStream | null = null;
    let sttDestroyed = false;

    (async () => {
      try {
        const { token, region } = await bridge.getAzureToken();
        if (sttDestroyed) return;
        azureTokenRef.current  = token;
        azureRegionRef.current = region;

        if (!navigator.mediaDevices?.getUserMedia) {
          setState((s) => ({
            ...s,
            sttError: "Microphone API unavailable. Check Windows Settings → Privacy → Microphone.",
          }));
          return;
        }

        // echoCancellation:false captures interviewer voice from speakers.
        // Fall back to true on drivers that reject the constraint.
        try {
          mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
          });
        } catch {
          try {
            mic = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
          } catch (permErr: any) {
            if (sttDestroyed) return;
            const denied = permErr?.name === "NotAllowedError" || permErr?.name === "PermissionDeniedError";
            setState((s) => ({
              ...s,
              sttError: denied
                ? "Microphone access denied. Allow mic in Windows Settings → Privacy → Microphone."
                : `Microphone error: ${permErr?.message || String(permErr)}`,
            }));
            return;
          }
        }
        if (sttDestroyed) { mic.getTracks().forEach((t) => t.stop()); mic = null; return; }

        // Speech config — same as website's AzureRecognizer
        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
        speechConfig.speechRecognitionLanguage = "en-US";
        speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
        speechConfig.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, "600");
        speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "600");

        // Push stream
        const fmt = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
        pushStream = SpeechSDK.AudioInputStream.createPushStream(fmt);

        // AudioContext with mixer destination so system audio can be added later
        const audioCtx = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
        if (audioCtx.state === "suspended") await audioCtx.resume();

        const mixDest = audioCtx.createMediaStreamDestination();
        audioCtxRef.current = audioCtx;
        mixDestRef.current  = mixDest;

        const micSource = audioCtx.createMediaStreamSource(mic);
        const micGain   = audioCtx.createGain();
        micGain.gain.value = 1.0;
        micSource.connect(micGain);
        micGain.connect(mixDest);

        const mergedSource = audioCtx.createMediaStreamSource(mixDest.stream);

        // AudioWorklet primary, ScriptProcessor fallback
        try {
          await audioCtx.audioWorklet.addModule("/pcm-processor.js");
          const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
          workletNode.port.postMessage({
            noiseFloor: 0.008, targetRms: 0.12, maxGain: 4, limiter: 0.92, silenceHoldFrames: 2,
          });
          workletNode.port.onmessage = (ev) => {
            if (pushStream && !sttDestroyed) pushStream.write(ev.data as ArrayBuffer);
          };
          mergedSource.connect(workletNode);
          workletNode.connect(audioCtx.destination);
        } catch {
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (ev) => {
            if (!pushStream || sttDestroyed) return;
            const f32 = ev.inputBuffer.getChannelData(0);
            const pcm = new Int16Array(f32.length);
            let sumSq = 0, peak = 0;
            for (let i = 0; i < f32.length; i++) {
              const a = Math.abs(f32[i]); if (a > peak) peak = a; sumSq += f32[i] * f32[i];
            }
            const rms = Math.sqrt(sumSq / Math.max(1, f32.length));
            if (rms < 0.008) { pcm.fill(0); pushStream.write(pcm.buffer); return; }
            const gain = Math.max(0.9, Math.min(4, rms > 0.0001 ? 0.12 / rms : 4));
            for (let i = 0; i < f32.length; i++) {
              let p = f32[i] * gain;
              if (Math.abs(p) > 0.92) p = Math.sign(p) * 0.92;
              if (peak > 0.98) p *= 0.92;
              const s = Math.max(-1, Math.min(1, p));
              pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            pushStream.write(pcm.buffer);
          };
          mergedSource.connect(processor);
          processor.connect(audioCtx.destination);
        }

        // Recognizer with phrase hints
        const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
        const recognizer  = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
        recognizerRef.current = recognizer;

        const pl = SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer);
        [
          "Flask", "Django", "FastAPI", "React", "Angular", "Vue", "Next.js", "Node.js",
          "TypeScript", "JavaScript", "Python", "Java", "Golang", "Rust",
          "Spring Boot", "AWS", "Azure", "GCP", "Kubernetes", "Docker", "Terraform",
          "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Kafka",
          "PyTorch", "TensorFlow", "LangChain", "LLM", "RAG", "vector database",
          "microservices", "REST API", "GraphQL", "gRPC", "system design",
          "OAuth", "JWT", "CI/CD", "GitHub Actions",
        ].forEach((p) => pl.addPhrase(p));

        recognizer.recognizing = (_s, e) => {
          if (pausedRef.current) return;
          const text = e.result.text;
          if (!text) return;
          transcriptRef.current = text;
          setState((s) => ({ ...s, transcript: text, sttError: "" }));
          socketRef.current?.emit("recognizing_item", { meetingId, text });

          // Barge-in: cancel AI stream when new interviewer speech arrives (same as website)
          if (isStreamingRef.current && !bargeInDoneRef.current) {
            bargeInDoneRef.current = true;
            const ws = wsAnswerRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "cancel", sessionId: meetingId }));
            }
            isStreamingRef.current = false;
            setState((s) => ({
              ...s,
              isStreaming: false,
              isAwaitingFirstChunk: false,
              statusLabel: "READY",
            }));
          }
        };

        recognizer.recognized = (_s, e) => {
          if (pausedRef.current) return;
          if (e.result.reason !== SpeechSDK.ResultReason.RecognizedSpeech) return;
          const raw = e.result.text?.trim();
          if (!raw) return;
          // Mic = candidate speech — add to transcript display only, no question detection
          const candidateText = `Candidate: ${applyAsrCorrections(cleanAsrNoise(raw))}`;
          transcriptSegsRef.current = [...transcriptSegsRef.current, candidateText];
          setState((s) => ({
            ...s,
            finalTranscript:    candidateText,
            transcript:         candidateText,
            transcriptSegments: transcriptSegsRef.current,
            sttError:           "",
          }));
          socketRef.current?.emit("recognized_item", { meetingId, text: candidateText, ts: Date.now() });
        };

        recognizer.canceled = (_s, e) => {
          if (!recognizerRef.current) return;
          if (e.reason === SpeechSDK.CancellationReason.Error) {
            setState((s) => ({ ...s, sttError: `STT error: ${e.errorDetails}` }));
          }
        };

        recognizer.sessionStarted = () => setState((s) => ({ ...s, sttError: "" }));

        recognizer.startContinuousRecognitionAsync(
          () => setState((s) => ({ ...s, sttError: "" })),
          (err) => setState((s) => ({ ...s, sttError: `Failed to start mic: ${err}` }))
        );
      } catch (err: any) {
        if (!sttDestroyed) {
          setState((s) => ({ ...s, sttError: err?.message || "Failed to start microphone" }));
        }
      }
    })();

    return () => {
      sttDestroyed = true;
      if (recognizerRef.current) {
        const r = recognizerRef.current; recognizerRef.current = null;
        r.stopContinuousRecognitionAsync(() => r.close(), () => r.close());
      }
      if (pushStream)          { try { pushStream.close();          } catch {} pushStream = null; }
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
      if (sysStreamRef.current){ sysStreamRef.current.getTracks().forEach((t) => t.stop()); sysStreamRef.current = null; }
      if (mic)                 { mic.getTracks().forEach((t) => t.stop()); mic = null; }
      mixDestRef.current = null;
    };
  }, [meetingId]);

  // ── System audio (interviewer) — dedicated STT stream ────────────────────
  const addSystemAudio = useCallback(async () => {
    try {
      // Toggle off
      if (sysStreamRef.current) {
        sysStreamRef.current.getTracks().forEach((t) => t.stop());
        sysStreamRef.current = null;
        interviewerRecognizerRef.current?.stopContinuousRecognitionAsync();
        interviewerRecognizerRef.current?.close();
        interviewerRecognizerRef.current = null;
        setState((s) => ({ ...s, systemAudioConnected: false }));
        return;
      }

      const token  = azureTokenRef.current;
      const region = azureRegionRef.current;
      if (!token || !region) {
        setState((s) => ({ ...s, sttError: "Azure token not ready — start mic first." }));
        return;
      }

      const displayStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      displayStream.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());

      const audioTracks: MediaStreamTrack[] = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        setState((s) => ({ ...s, sttError: "No system audio captured. Check 'Share system audio' in the share dialog." }));
        return;
      }

      // Dedicated AudioContext → pushStream for interviewer audio only
      const ivCtx = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
      if (ivCtx.state === "suspended") await ivCtx.resume();
      const ivDest   = ivCtx.createMediaStreamDestination();
      const sysSource = ivCtx.createMediaStreamSource(displayStream);
      const sysGain   = ivCtx.createGain();
      sysGain.gain.value = 1.3;
      sysSource.connect(sysGain);
      sysGain.connect(ivDest);

      const fmt        = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      const ivPush     = SpeechSDK.AudioInputStream.createPushStream(fmt);
      const ivMerged   = ivCtx.createMediaStreamSource(ivDest.stream);

      try {
        await ivCtx.audioWorklet.addModule("/pcm-processor.js");
        const wn = new AudioWorkletNode(ivCtx, "pcm-processor");
        wn.port.postMessage({ noiseFloor: 0.008, targetRms: 0.12, maxGain: 4, limiter: 0.92, silenceHoldFrames: 2 });
        wn.port.onmessage = (ev) => { if (!sysStreamRef.current) return; ivPush.write(ev.data as ArrayBuffer); };
        ivMerged.connect(wn);
        wn.connect(ivCtx.destination);
      } catch {
        const proc = ivCtx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (ev) => {
          if (!sysStreamRef.current) return;
          const f32 = ev.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(f32.length);
          let sumSq = 0;
          for (let i = 0; i < f32.length; i++) sumSq += f32[i] * f32[i];
          const rms = Math.sqrt(sumSq / Math.max(1, f32.length));
          if (rms < 0.008) { pcm.fill(0); ivPush.write(pcm.buffer); return; }
          const gain = Math.max(0.9, Math.min(4, rms > 0.0001 ? 0.12 / rms : 4));
          for (let i = 0; i < f32.length; i++) {
            let p = f32[i] * gain;
            if (Math.abs(p) > 0.92) p = Math.sign(p) * 0.92;
            pcm[i] = Math.max(-1, Math.min(1, p)) < 0 ? Math.max(-1, Math.min(1, p)) * 0x8000 : Math.max(-1, Math.min(1, p)) * 0x7fff;
          }
          ivPush.write(pcm.buffer);
        };
        ivMerged.connect(proc);
        proc.connect(ivCtx.destination);
      }

      // Interviewer recognizer — full question detection
      const ivSpeechCfg = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
      ivSpeechCfg.speechRecognitionLanguage = "en-US";
      ivSpeechCfg.outputFormat = SpeechSDK.OutputFormat.Detailed;
      ivSpeechCfg.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, "600");
      ivSpeechCfg.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "600");

      const ivAudioCfg   = SpeechSDK.AudioConfig.fromStreamInput(ivPush);
      const ivRecognizer = new SpeechSDK.SpeechRecognizer(ivSpeechCfg, ivAudioCfg);
      interviewerRecognizerRef.current = ivRecognizer;

      const ivPl = SpeechSDK.PhraseListGrammar.fromRecognizer(ivRecognizer);
      ["Flask","Django","FastAPI","React","Angular","Vue","Next.js","Node.js","TypeScript","JavaScript",
       "Python","Java","Golang","Rust","Spring Boot","AWS","Azure","GCP","Kubernetes","Docker",
       "Terraform","PostgreSQL","MySQL","MongoDB","Redis","Kafka","microservices","REST API","GraphQL",
       "OAuth","JWT","CI/CD"].forEach((p) => ivPl.addPhrase(p));

      // Interim — barge-in
      ivRecognizer.recognizing = (_s, e) => {
        if (pausedRef.current) return;
        const text = e.result.text;
        if (!text) return;
        transcriptRef.current = `Interviewer: ${text}`;
        setState((s) => ({ ...s, transcript: `Interviewer: ${text}`, sttError: "" }));
        socketRef.current?.emit("recognizing_item", { meetingId, text: `Interviewer: ${text}` });
        if (isStreamingRef.current && !bargeInDoneRef.current) {
          bargeInDoneRef.current = true;
          const ws = wsAnswerRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cancel", sessionId: meetingId }));
          isStreamingRef.current = false;
          setState((s) => ({ ...s, isStreaming: false, isAwaitingFirstChunk: false, statusLabel: "READY" }));
        }
      };

      // Final — full question detection (interviewer only)
      ivRecognizer.recognized = (_s, e) => {
        if (pausedRef.current) return;
        if (e.result.reason !== SpeechSDK.ResultReason.RecognizedSpeech) return;
        const raw = e.result.text?.trim();
        if (!raw) return;
        let text = applyAsrCorrections(cleanAsrNoise(raw));
        const now = Date.now();
        const msSinceLast = lastSegmentTsRef.current > 0 ? now - lastSegmentTsRef.current : Infinity;
        const prevSeg  = transcriptSegsRef.current[transcriptSegsRef.current.length - 1] || "";
        const prevNorm = prevSeg.replace(/^interviewer:\s*/i, "").toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
        const curNorm  = text.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
        const curWc    = curNorm.split(/\s+/).filter(Boolean).length;
        const curIsNewQuestion = detectQuestion(text) ||
          /^(what|why|how|when|where|who|which|tell me|explain|describe|walk me|do you|are you|have you|can you|could you|would you)\b/i.test(curNorm);

        if (prevSeg && msSinceLast <= 10_000 && !curIsNewQuestion) {
          const prevIsQlike = detectQuestion(prevSeg) || detectQuestionAdvanced(prevSeg).confidence >= 0.5;
          const isContinuationTail = /^(and also|and|also|plus|as well as)\b/i.test(text) && curWc >= 2 && curWc <= 10;
          if (prevIsQlike && isContinuationTail) {
            const prevNoQ = prevNorm.replace(/\?\s*$/, "").trim();
            const stitched = `${prevNoQ} ${text}`.replace(/\s+/g, " ").trim();
            if (detectQuestion(stitched) || detectQuestionAdvanced(stitched).confidence >= 0.5)
              text = stitched.endsWith("?") ? stitched : `${stitched}?`;
          }
          if (text === applyAsrCorrections(raw) && prevIsQlike && curWc <= 4 && STANDALONE_TECH_RE.test(text)) {
            const prevNoQ = prevNorm.replace(/\?\s*$/, "").trim();
            const joiner  = /\b(in|with|on|for|and)\s*$/i.test(prevNoQ) ? "" : " and";
            const stitched = `${prevNoQ}${joiner} ${text}`.replace(/\s+/g, " ").trim();
            if (detectQuestion(stitched) || detectQuestionAdvanced(stitched).confidence >= 0.5)
              text = stitched.endsWith("?") ? stitched : `${stitched}?`;
          }
        }

        lastSegmentTsRef.current = now;
        const labeled = `Interviewer: ${text}`;
        finalTranscriptRef.current = labeled;
        transcriptRef.current      = labeled;
        transcriptSegsRef.current  = [...transcriptSegsRef.current, labeled];

        if (detectQuestion(text) && !isLikelyIncompleteFragment(text) && !isLikelyNoiseSegment(text)) {
          questionMemoryRef.current = [{ text, answered: false, ts: now }, ...questionMemoryRef.current].slice(0, 30);
        }
        setState((s) => ({
          ...s,
          finalTranscript:    labeled,
          transcript:         labeled,
          transcriptSegments: transcriptSegsRef.current,
          sttError:           "",
        }));
        socketRef.current?.emit("recognized_item", { meetingId, text: labeled, ts: now });
      };

      ivRecognizer.startContinuousRecognitionAsync(
        () => {},
        (err) => setState((s) => ({ ...s, sttError: `Interviewer STT error: ${err}` }))
      );

      sysStreamRef.current = displayStream;
      audioTracks[0].onended = () => {
        sysStreamRef.current = null;
        interviewerRecognizerRef.current?.stopContinuousRecognitionAsync();
        interviewerRecognizerRef.current = null;
        setState((s) => ({ ...s, systemAudioConnected: false }));
      };

      setState((s) => ({ ...s, systemAudioConnected: true, sttError: "" }));
    } catch (err: any) {
      if (err?.name === "NotAllowedError") return;
      setState((s) => ({ ...s, sttError: `System audio error: ${err?.message || String(err)}` }));
    }
  }, [meetingId]);

  // ── Send question to /ws — same as website ────────────────────────────────
  const sendQuestion = useCallback((text: string, submitSource: string, formatOverride?: string, clearContext?: boolean) => {
    const ws = wsAnswerRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Sanitize the question text (same as website's sanitizeQuestionCandidate)
    const cleanText = sanitizeQuestionCandidate(text) || text;

    // Duplicate suppression — don't re-send near-identical questions (same as website)
    const fp = normalizeQuestionForSimilarity(cleanText);
    if (fp) {
      if (lastSentQuestionNormRef.current && levenshteinSimilarity(fp, lastSentQuestionNormRef.current) >= 0.85) return;
      for (const prev of recentAskedFingerprintsRef.current) {
        if (levenshteinSimilarity(fp, prev) >= 0.85) return;
      }
    }

    // Try to bundle follow-up questions (same as website's maybeWrapHybridFollowups)
    const hybrid = maybeWrapHybridFollowups(cleanText, questionMemoryRef.current);
    const finalText        = hybrid ? hybrid.seedText        : cleanText;
    const displayQuestion  = hybrid ? hybrid.displayQuestion : cleanText;
    const multiQuestionMode = hybrid ? true : false;

    const fmt = formatOverride || resolveFormat(cleanText);

    // liveTranscript: segments in reverse chronological order (same as website)
    const segs = transcriptSegsRef.current;
    const liveTranscript = segs.length > 0
      ? [...segs].reverse().slice(0, 20).join("\n")
      : undefined;

    const lastInterviewerQuestion = clearContext ? undefined : (lastQuestionRef.current || undefined);
    const recentSpokenReply       = clearContext ? undefined : (lastAnswerRef.current   || undefined);
    const conversationHistory     = clearContext ? undefined : (qaHistoryRef.current.length > 0 ? qaHistoryRef.current.slice(-3) : undefined);

    ws.send(JSON.stringify({
      type:      "question",
      sessionId: meetingId,
      text:      finalText,
      force:     true,
      format:    fmt,
      model:     "automatic",
      quickMode: fmt !== "code_example" && fmt !== "technical",
      docsMode:  "auto",
      metadata: {
        mode:                  "enter",
        audioMode:             "mic",
        submitSource,
        multiQuestionMode,
        speculative:           false,
        docsMode:              "auto",
        lastInterviewerQuestion,
        recentSpokenReply,
        liveTranscript,
        conversationHistory,
      },
    }));

    // Remember fingerprint for dedup
    if (fp) {
      lastSentQuestionNormRef.current = fp;
      recentAskedFingerprintsRef.current = [
        fp,
        ...recentAskedFingerprintsRef.current.filter((x) => x !== fp),
      ].slice(0, 20);
    }

    // Mark all memory questions as answered
    questionMemoryRef.current = questionMemoryRef.current.map((q) => ({ ...q, answered: true }));

    // Track this question for follow-up context
    lastQuestionRef.current = displayQuestion;

    setState((s) => ({
      ...s,
      question:             displayQuestion,
      answer:               "",
      isAwaitingFirstChunk: true,
      isStreaming:          false,
      statusLabel:          "THINKING",
    }));
    streamBufRef.current = "";
  }, [meetingId]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const requestAnswer = useCallback(() => {
    const now = Date.now();
    const TTL = 90_000; // same as website's UNANSWERED_TTL_MS
    const currentText = finalTranscriptRef.current || transcriptRef.current;

    // Priority 1: if current text is a follow-up to AI's last answer, send it directly
    // (same as website's isFollowUp check in resolveEnterSeed)
    if (currentText && lastAnswerRef.current) {
      const fuResult = isFollowUp(currentText);
      if (fuResult.isFollowUp) {
        sendQuestion(currentText, "enter_key");
        return;
      }
    }

    // Priority 2: best unanswered question from memory (not noise, sorted newest first)
    const bestMemoryQ = questionMemoryRef.current
      .filter((q) => !q.answered && (now - q.ts) <= TTL && !isLikelyNoiseSegment(q.text))
      .sort((a, b) => b.ts - a.ts)[0]?.text;

    if (bestMemoryQ) {
      sendQuestion(bestMemoryQ, "enter_key");
      return;
    }

    // Priority 2.5: extract best question from recent segments (same as website's resolveEnterSeed)
    const candidates = extractAnyQuestionCandidates(transcriptSegsRef.current);
    const bestFromSegs = pickBestRecentQuestionSeed(
      candidates.length > 0 ? candidates : transcriptSegsRef.current,
    );
    if (bestFromSegs) {
      sendQuestion(bestFromSegs, "enter_key");
      return;
    }

    // Priority 3: current transcript, Priority 4: "[Continue]"
    const text = currentText || "[Continue]";
    sendQuestion(text, "enter_key");
  }, [sendQuestion]);

  const sendFollowUp = useCallback((text: string, format?: string, clearContext?: boolean) => {
    sendQuestion(text, "send_icon", format, clearContext);
  }, [sendQuestion]);

  const cancelStream = useCallback(() => {
    const ws = wsAnswerRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "cancel", sessionId: meetingId }));
    }
    isStreamingRef.current = false;
    setState((s) => ({
      ...s,
      isStreaming:          false,
      isAwaitingFirstChunk: false,
      statusLabel:          "READY",
    }));
  }, [meetingId]);

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setState((s) => ({
      ...s,
      isPaused:    pausedRef.current,
      statusLabel: pausedRef.current ? "PAUSED" : "READY",
    }));
  }, []);

  const retry = useCallback(() => {
    const q = lastQuestionRef.current;
    if (q) sendQuestion(q, "retry");
  }, [sendQuestion]);

  return {
    state: { ...state, isPaused: pausedRef.current },
    requestAnswer,
    sendFollowUp,
    cancelStream,
    togglePause,
    retry,
    addSystemAudio,
  };
}
