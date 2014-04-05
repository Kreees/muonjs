var express = require("express"),
    fs = require("fs"),
    Q = require("q"),
    _ = require("underscore"),
    mime = require("mime"),
    zlib = require("zlib");

var app = m.sys.app = require("./../express_init.js");

m.errorize = function(res,statusCode,message){
    res.statusCode = statusCode;
    res.set("Content-Type","text/javascript");
    res.end(JSON.stringify({error: message,statusCode: statusCode}));
}

var serverReloadFlag = true;

function getServerHandler(){
    return {
        compileClient: m.sys.require("/client/client_render"),
        compileMuonJs: m.sys.require("/client/muon_render"),
        packageRender: m.sys.require("/client/package_render"),
        packageView: m.sys.require("/client/package_view"),
        packageTranslation: m.sys.require("/client/package_translation"),
        apiProc: m.sys.require("/router/api_router").run
    };
};

var server = getServerHandler();

function baseConfig(){
    app.use(require('less-middleware')(m.cfg.path + '/client/assets/'));
    app.use(express.static(m.cfg.path + '/client/assets/'));
    app.use("/favicon.ico",function(req,res){res.writeHead(404,"Not found");res.end("")});
    app.use("/",function(req,res,next){
        if (req.path.match(/\.map$/)) {
            res.writeHead(404,"Not found");
            res.end("");
        }
        else next()
    });
    app.use(express.limit('15mb'));
    app.use(express.bodyParser({keepExtensions:true,uploadDir: m.cfg.path+"/uploads"}));
    app.use(express.cookieParser());
    app.use(express.compress());
    if (m.cfg.logger) app.use(express.logger());
};

function devConfig(){if (m.cfg.autoreload) app.use(function(req,res,next){
        if (serverReloadFlag)
            setTimeout(function(){
                serverReloadFlag = true
            },3000);
        else{
            function relaunch(){
                if (m.sys.serverInitFlag) return setTimeout(relaunch,100);
                next();
            }
            return relaunch();
        }
        m.reload(function(){
            server = getServerHandler();
            serverHandler.driver = server;
            serverReloadFlag = false;
            next();
        })
    });
    app.use("/muon.js",function(req,res){
        server.compileMuonJs(req,res);
    });
    app.use(function(req,res,next){
        if (req.get('muon-request') == "data-request" || _.isString(req.query.muon)){
            delete req.query.muon;
            return _.defer(next);
        }
        server.compileClient(req,res);
    });
    app.use("/apis",function(req,res){
        try{ server.apiProc(req,res); }
        catch(e){
            m.error(e);
            res.statusCode = 500;
            res.end("Error");
        }
    });
    app.use("/pack",function(req,res){
        server.packageRender(req,res);
    });
    app.use("/pack_view",function(req,res){
        server.packageView(req,res);
    });
    app.use("/pack_translation",function(req,res){
        server.packageTranslation(req,res);
    });
    app.use("/pack_src",function(req,res){
        var path = req.path.replace(/^\//,"");
        path = path.split("/");
        if (path.length < 2){
            res.statusCode = 404;
            return res.end("Wrong package");
        }
        var pack = path.shift();
        var plugin = pack.split(":");
        pack = plugin.pop();
        if (plugin.length == 0) plugin = "";
        else plugin = plugin.join(":");
        if (!(plugin in m.__plugins)){
            res.statusCode = 404;
            return res.end("Wrong plugin name");
        }

        var file = path.join("/");
        var fileName = m.__plugins[plugin].cfg.path+"/client/packages/"+pack +"/dependencies/src/"+file;
        if (!fs.existsSync(fileName)){
            res.statusCode = 404;
            return res.end("File doesn't exists");
        }
        var mimeType = mime.lookup(fileName)
        res.writeHead(200,{"Content-Type":mimeType});
        if (/^text/.test(mimeType))
            res.end(fs.readFileSync(fileName,"utf-8"))
        else
            res.end(fs.readFileSync(fileName));
    });
}

function dryConfig(){
    var muon;
    server.compileMuonJs({},{
        set: function(){},
        end: function(data){
            muon = data;
        }
    });
    app.use("/muon.js",function(req,res){
        res.set("Content-Type","text/javascript");
        res.end(muon);
    });
    app.use(function(req,res,next){
        if (req.get('muon-request') == "data-request" || _.isString(req.query.muon)){
            delete req.query.muon;
            next();
        }
        else server.compileClient(req,res);
    });
    app.use("/apis",server.apiProc);
    app.use("/pack",server.packageRender);
    app.use("/pack_translation",server.packageTranslation);
    app.use("/pack_src",function(req,res){
        var path = req.path.replace(/^\//,"");
        path = path.split("/");
        if (path.length < 2){
            res.statusCode = 404;
            return res.end("Wrong package");
        }
        var pack = path.shift();
        var plugin = pack.split(":");
        pack = plugin.pop();
        if (plugin.length == 0) plugin = "";
        else plugin = plugin.join(":");
        if (!(plugin in m.__plugins)){
            res.statusCode = 404;
            return res.end("Wrong plugin name");
        }

        var file = path.join("/");
        var fileName = m.__plugins[plugin].cfg.path+"/client/packages/"+pack +"/dependencies/src/"+file;
        if (!fs.existsSync(fileName)){
            res.statusCode = 404;
            return res.end("File doesn't exists");
        }
        var mimeType = mime.lookup(fileName)
        res.writeHead(200,{"Content-Type":mimeType});
        if (/^text/.test(mimeType))
            res.end(fs.readFileSync(fileName,"utf-8"))
        else
            res.end(fs.readFileSync(fileName));
    });
};

function serverHandler(req,res){
    app.handle(req,res);
}

serverHandler.listen = function(port,host,callback){
    switch(arguments.length){
        case 0:
            callback = function(){};
            break;
        case 1:
            if (typeof port == "function") callback = port;
            else {
                m.cfg.port = port;
                callback = function(){};
            }
            break;
        case 2:
            m.cfg.port = port;
            if (typeof host == "function") callback = host;
            else {
                m.cfg.host = host;
                callback = function(){};
            }
            break;
        case 3:
            m.cfg.port = port;
            m.cfg.host = host;
            if (typeof callback != "function"){
                console.log("Warnning! Third argument of listen should be a callback method.");
                callback = function(){};
            }
            break;
        default: throw Error("Wrong arguments.");
    }

    var serv;
    if (m.cfg.protocol.toUpperCase() == "HTTPS"){
        serv = require("https").createServer({
            key: fs.readFileSync(m.cfg.path+"/"+ m.cfg.https.key),
            cert:fs.readFileSync(m.cfg.path+"/"+ m.cfg.https.cert)
        },app);
    }
    else serv = require("http").createServer(app);

    serverHandler.srv = serv;
    var incomeSocks = [];

    serv.on("connection",function(sock){
        incomeSocks.push(sock)
        sock.on("close",function(){ incomeSocks.splice(incomeSocks.indexOf(sock),1); });
    });

    serverHandler.close = function(callback){
        incomeSocks.forEach(function(sock){ sock.destroy(); });
        return serv.close(callback);
    }

    return serv.listen(m.cfg.port,m.cfg.host,callback);
};

(function(){
    if (["testing","development","production"].indexOf(m.cfg.serverMode) == -1) {
        m.kill("Error: wrong server mode: " + m.cfg.serverMode);
    }
    app.set("env",m.cfg.serverMode.toLowerCase());
    baseConfig();
    app.configure("development", devConfig);
    app.configure("production", dryConfig);
    app.configure("sitemap", dryConfig);
    app.configure("testing", function(){
        dryConfig();
    });
    app.use(app.router);
})();

serverHandler.driver = server;

module.exports = serverHandler;
