const fs = require('fs');
const path = require('path');

// List of common proper names to remove
const PROPER_NAMES = new Set([
  'PAULO', 'MARIA', 'JESUS', 'JORGE', 'ANDRÉ', 'BRUNO', 'CARLOS', 'PEDRO',
  'LUCAS', 'MARCOS', 'ANTÔNIO', 'JOSÉ', 'JOÃO', 'FRANCISCO', 'MANUEL',
  'RAFAEL', 'FERNANDO', 'ROBERTO', 'RICARDO', 'EDUARDO', 'DANIEL', 'MIGUEL',
  'RODRIGO', 'FELIPE', 'ALEXANDRE', 'GUSTAVO', 'MARCELO', 'LEONARDO', 'THIAGO',
  'VICTOR', 'MATHEUS', 'GABRIEL', 'ARTHUR', 'LUIZ', 'DOUGLAS', 'FABIO', 'ALAN',
  'ANDERSON', 'BRUNO', 'CAIO', 'DIEGO', 'EDSON', 'FABIANO', 'FERNANDA', 'GEOVANNA',
  'GIOVANNA', 'HEITOR', 'ISABELA', 'JULIANA', 'LARISSA', 'LETÍCIA', 'LUCIA',
  'MARCELA', 'MARIANA', 'NATHALIA', 'PATRÍCIA', 'RAQUEL', 'RENATA', 'SANDRA',
  'TATIANA', 'VANESSA', 'VIVIAN', 'YASMIN', 'ANA', 'BEATRIZ', 'CAMILA', 'CARLA',
  'CLAUDIA', 'CRISTINA', 'DANIELA', 'ELIANE', 'FABIANA', 'FERNANDA', 'GABRIELA',
  'GISELE', 'HELENA', 'ISABEL', 'JÉSSICA', 'JULIA', 'KARINA', 'LAURA', 'LUCIANA',
  'MARGARIDA', 'MONICA', 'NATÁLIA', 'OLÍVIA', 'PAULA', 'RAFAELA', 'REGINA',
  'SABRINA', 'SARA', 'SONIA', 'TÂNIA', 'VALÉRIA', 'VERÔNICA', 'VITORIA'
]);

// Technical terms, brand names, and foreign words to remove
const TECHNICAL_TERMS = new Set([
  'HTTPS', 'EMAIL', 'WEBER', 'XEROX', 'KODAK', 'JAVA', 'HTML', 'PHP', 'CSS',
  'SQL', 'API', 'URL', 'PDF', 'JPG', 'PNG', 'GIF', 'MP3', 'MP4', 'DVD', 'CD',
  'USB', 'HD', 'CPU', 'GPU', 'RAM', 'ROM', 'LED', 'LCD', 'OLED', 'WIFI', 'BLUETOOTH',
  'GPS', 'NFC', 'RFID', 'VPN', 'LAN', 'WAN', 'MAN', 'ISP', 'DNS', 'IP', 'TCP',
  'UDP', 'HTTP', 'FTP', 'SSH', 'SSL', 'TLS', 'JSON', 'XML', 'YAML', 'CSV', 'ZIP',
  'RAR', 'TAR', 'GZ', 'BZ2', 'EXE', 'DLL', 'BAT', 'SH', 'BASH', 'PYTHON', 'RUBY',
  'PERL', 'GO', 'RUST', 'SWIFT', 'KOTLIN', 'SCALA', 'HASKELL', 'ELIXIR', 'ERLANG',
  'CLOJURE', 'LISP', 'SCHEME', 'FORTRAN', 'COBOL', 'PASCAL', 'BASIC', 'ALGOL',
  'ADA', 'PLSQL', 'TCL', 'LUA', 'DART', 'GROOVY', 'JAVASCRIPT', 'TYPESCRIPT',
  'COFFEESCRIPT', 'ECMASCRIPT', 'NODEJS', 'REACT', 'ANGULAR', 'VUE', 'EMBER',
  'BACKBONE', 'JQUERY', 'BOOTSTRAP', 'FOUNDATION', 'MATERIALIZE', 'SEMANTIC',
  'BULMA', 'TAILWIND', 'SASS', 'LESS', 'STYLUS', 'POSTCSS', 'WEBPACK', 'ROLLUP',
  'PARCEL', 'BROWSERIFY', 'GULP', 'GRUNT', 'NPM', 'YARN', 'BOWER', 'COMPOSER',
  'PIP', 'GEM', 'NUGET', 'MAVEN', 'GRADLE', 'ANT', 'MAKE', 'CMAKE', 'AUTOCONF',
  'DOCKER', 'KUBERNETES', 'AWS', 'AZURE', 'GCP', 'HEROKU', 'DIGITALOCEAN',
  'LINODE', 'VULTR', 'AWS', 'S3', 'EC2', 'LAMBDA', 'DYNAMODB', 'RDS', 'ELASTIC',
  'REDIS', 'MONGODB', 'POSTGRES', 'MYSQL', 'SQLITE', 'ORACLE', 'SQLSERVER',
  'MARIADB', 'CASSANDRA', 'COUCHDB', 'NEO4J', 'ARANGODB', 'INFLUXDB', 'PROMETHEUS',
  'GRAFANA', 'KIBANA', 'ELASTICSEARCH', 'LOGSTASH', 'KIBANA', 'FILEBEAT',
  'METRICBEAT', 'PACKETBEAT', 'HEARTBEAT', 'AUDITBEAT', 'FUNCTIONBEAT', 'WINLOGBEAT',
  'JOURNALBEAT', 'KAFKA', 'RABBITMQ', 'ACTIVEMQ', 'ZEROMQ', 'NATS', 'REDIS',
  'MEMCACHED', 'ETCD', 'CONSUL', 'ZOOKEEPER', 'VAULT', 'NOMAD', 'TERRAFORM',
  'PACKER', 'VAGRANT', 'ANSIBLE', 'CHEF', 'PUPPET', 'SALT', 'CFENGINE', 'RUNDECK',
  'JENKINS', 'TRAVIS', 'CIRCLE', 'GITLAB', 'GITHUB', 'BITBUCKET', 'BAMBOO',
  'TEAMCITY', 'GOCD', 'CONCOURSE', 'SPINNAKER', 'ARGOCD', 'FLUX', 'HELM',
  'KOPS', 'KUBECTL', 'MINIKUBE', 'KIND', 'K3S', 'K0S', 'MICROK8S', 'RANCHER',
  'OPENSHIFT', 'MESOS', 'NOMAD', 'DOCKER', 'CONTAINERD', 'CRIO', 'PODMAN',
  'BUILDKIT', 'KANIKO', 'JIB', 'SKAFOLD', 'TEKTON', 'FLUX', 'ARGOCD', 'OCTANT',
  'LENS', 'KUBERNETES', 'K8S', 'ISTIO', 'LINKERD', 'CONTOUR', 'TRAEFIK', 'NGINX',
  'APACHE', 'TOMCAT', 'JETTY', 'UNDERTOW', 'NETTY', 'VERTX', 'AKKA', 'PLAY',
  'DROPWIZARD', 'SPRING', 'QUARKUS', 'MICRONAUT', 'HELIDON', 'JAXRS', 'JAXWS',
  'JAXB', 'JAXP', 'JMS', 'JPA', 'JDBC', 'JNDI', 'JMX', 'JTA', 'JTS', 'JCA',
  'JCE', 'JAAS', 'JSSE', 'JGSS', 'JAI', 'JMF', 'JINI', 'JXTA', 'JAVACARD',
  'JAVAME', 'JAVAFX', 'SWING', 'AWT', 'JAVABEANS', 'EJB', 'CDI', 'JSF', 'JSP',
  'SERVLET', 'FILTER', 'LISTENER', 'TAGLIB', 'EL', 'JSTL', 'FACELE', 'PRIMEFACES',
  'RICHFACES', 'ICEFACES', 'OPENFACES', 'BUTTERFACES', 'BOOTSFACES', 'ANGULARFACES',
  'PRIMENG', 'NGBOOTSTRAP', 'CLARITY', 'CARBON', 'MATERIAL', 'BOOTSTRAP', 'FOUNDATION',
  'SEMANTIC', 'BULMA', 'TAILWIND', 'CHAKRA', 'ANTD', 'ELEMENT', 'VUETIFY', 'QUASAR',
  'BUEfy', 'ELEMENTUI', 'IVIEW', 'NUTUI', 'MINTUI', 'VANT', 'WEUI', 'COLORUI',
  'TACHYONS', 'BASS', 'MILLIGRAM', 'PICNIC', 'PURE', 'Skeleton', 'Spectre', 'UIkit',
  'W3CSS', 'NES', 'HACK', 'MVP', 'Sakura', 'Water', 'Wing', 'Bamboo', 'Blaze',
  'Cirrus', 'Concise', 'Cutestrap', 'Furtive', 'Gral', 'Kube', 'Mobi', 'Mui',
  'Nprogress', 'Pocket', 'Rati', 'Rolodex', 'Shorthand', 'Siesta', 'Spruce',
  'Strawberry', 'Tacit', 'Tachyons', 'Tent', 'Tocas', 'Turret', 'Unsemantic',
  'Vital', 'Writ', 'Yaml', 'Zurb', 'ACSS', 'OOCSS', 'SMACSS', 'BEM', 'ITCSS',
  'ECSS', 'MCSS', 'AMCSS', 'PACSS', 'FUN', 'SUIT', 'RSCSS', 'RSJS', 'ATOMIC',
  'DRY', 'KISS', 'YAGNI', 'SOLID', 'GRASP', 'DRY', 'KISS', 'YAGNI', 'SOLID',
  'GRASP', 'DRY', 'KISS', 'YAGNI', 'SOLID', 'GRASP', 'DRY', 'KISS', 'YAGNI',
  'SOLID', 'GRASP', 'DRY', 'KISS', 'YAGNI', 'SOLID', 'GRASP', 'DRY', 'KISS',
  'YAGNI', 'SOLID', 'GRASP', 'DRY', 'KISS', 'YAGNI', 'SOLID', 'GRASP', 'DRY',
  'KISS', 'YAGNI', 'SOLID', 'GRASP', 'DRY', 'KISS', 'YAGNI', 'SOLID', 'GRASP'
]);

// Foreign words that don't follow Portuguese patterns
const FOREIGN_PATTERNS = [
  /[^A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/,
  /[KWXY]/ // Letters not typically used in Portuguese words
];

function isProperName(word) {
  return PROPER_NAMES.has(word);
}

function isTechnicalTerm(word) {
  return TECHNICAL_TERMS.has(word);
}

function isForeignWord(word) {
  // Check for foreign patterns
  return FOREIGN_PATTERNS.some(pattern => pattern.test(word));
}

function isValidPortugueseWord(word) {
  // Basic Portuguese word validation
  if (word.length !== 5) return false;
  
  // Check if it's a proper name
  if (isProperName(word)) return false;
  
  // Check if it's a technical term
  if (isTechnicalTerm(word)) return false;
  
  // Check if it looks like a foreign word
  if (isForeignWord(word)) return false;
  
  // Check for common Portuguese word patterns
  const portuguesePattern = /^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]+$/;
  if (!portuguesePattern.test(word)) return false;
  
  return true;
}

function filterWords() {
  const inputPath = path.join(__dirname, '../server/top-5000-portuguese-words.txt');
  const outputPath = path.join(__dirname, '../server/filtered-portuguese-words.txt');
  
  try {
    const content = fs.readFileSync(inputPath, 'utf8');
    const words = content.split('\n').map(word => word.trim()).filter(word => word.length === 5);
    
    console.log(`Original word count: ${words.length}`);
    
    const filteredWords = words.filter(word => isValidPortugueseWord(word));
    
    console.log(`Filtered word count: ${filteredWords.length}`);
    console.log(`Removed ${words.length - filteredWords.length} words`);
    
    // Save filtered words
    fs.writeFileSync(outputPath, filteredWords.join('\n'));
    console.log(`Filtered words saved to: ${outputPath}`);
    
    // Show some examples of removed words
    const removedWords = words.filter(word => !isValidPortugueseWord(word));
    console.log('\nExamples of removed words:');
    console.log(removedWords.slice(0, 20).join(', '));
    
  } catch (error) {
    console.error('Error processing file:', error);
  }
}

filterWords();
