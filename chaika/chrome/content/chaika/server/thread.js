Components.utils.import("resource://chaika-modules/ChaikaCore.js");
Components.utils.import("resource://chaika-modules/ChaikaBoard.js");
Components.utils.import("resource://chaika-modules/ChaikaThread.js");

this.script = {

	start: function(aServerHandler){
		aServerHandler.setResponseHeader("Content-Type", "text/html; charset=Shift_JIS");
		aServerHandler.writeResponseHeader(200);

		var threadURL = this.getThreadURL(aServerHandler.requestURL);
		if(!threadURL){
			aServerHandler.write("BAD URL");
			aServerHandler.close();
			return;
		}
		var boardURL = ChaikaThread.getBoardURL(threadURL);
		var type = ChaikaBoard.getBoardType(threadURL);
			// 板のタイプが、BOARD_TYPE_PAGE でも、
			// URL に /test/read.cgi/ を含んでいたら 2ch互換とみなす
		if(type == ChaikaBoard.BOARD_TYPE_PAGE &&
					threadURL.spec.indexOf("/test/read.cgi/") != -1){
			type = ChaikaBoard.BOARD_TYPE_2CH;
		}


		switch(type){
			case ChaikaBoard.BOARD_TYPE_2CH:
				this.thread = new b2rThread2ch();
				break;
			case ChaikaBoard.BOARD_TYPE_JBBS:
				this.thread = new b2rThreadJbbs();
				break;
			case ChaikaBoard.BOARD_TYPE_MACHI:
				this.thread = new b2rThreadMachi();
				break;
			default:
				this.thread = null;
				break;
		}

		if(this.thread){
			this.thread.init(aServerHandler, threadURL, boardURL, type);
		}else{
			aServerHandler.write("No Supported Boad");
			aServerHandler.close();
		}
	},

	cancel: function(){
		if(this.thread){
			this.thread.close();
			this.thread = null;
		}
	},

	getThreadURL: function(aRequestURL){
		var threadURLSpec = aRequestURL.path.substring(8);
		if(threadURLSpec == "") return null;

		// threadURLSpec = decodeURIComponent(threadURLSpec);
		var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
		try{
			var threadURL = ioService.newURI(threadURLSpec, null, null).QueryInterface(Ci.nsIURL);
				// URL が、DAT ID で終わるときは "/" を追加する
			if(threadURL.fileName.match(/^\d{9,10}$/)){
				threadURL = ioService.newURI(threadURLSpec + "/", null, null)
						.QueryInterface(Ci.nsIURL);
			}
			return threadURL;
		}catch(ex){}

		return null;
	}

};


var UniConverter = {

	_unicodeConverter: Cc["@mozilla.org/intl/scriptableunicodeconverter"]
			.createInstance(Ci.nsIScriptableUnicodeConverter),

	toSJIS: function uniConverter_toSJIS(aString){
		this._unicodeConverter.charset = "Shift_JIS";
		return this._unicodeConverter.ConvertFromUnicode(aString);
	},

	fromSJIS: function uniConverter_fromSJIS(aString){
		this._unicodeConverter.charset = "Shift_JIS";
		return this._unicodeConverter.ConvertToUnicode(aString);
	},

	toEUC: function uniConverter_toEUC(aString){
		this._unicodeConverter.charset = "EUC-JP";
		return this._unicodeConverter.ConvertFromUnicode(aString);
	},

	fromEUC: function uniConverter_fromEUC(aString){
		this._unicodeConverter.charset = "EUC-JP";
		return this._unicodeConverter.ConvertToUnicode(aString);
	}

};


// ***** ***** ***** ***** ***** b2rThread2ch ***** ***** ***** ***** *****
function b2rThread2ch(){
}

b2rThread2ch.prototype = {

	get optionsOnes(){
		return (this.thread.url.fileName.match(/^(\d+)n?$/)) ? parseInt(RegExp.$1) : null;
	},
	get optionsStart(){
		return (this.thread.url.fileName.match(/(\d+)\-/)) ? parseInt(RegExp.$1) : null;
	},
	get optionsLast(){
		return (this.thread.url.fileName.match(/l(\d+)/)) ? parseInt(RegExp.$1) : null;
	},
	get optionsEnd(){
		return (this.thread.url.fileName.match(/\-(\d+)/)) ? parseInt(RegExp.$1) : null;
	},
	get optionsNoFirst(){
		return (this.thread.url.fileName.indexOf("n") != -1);
	},

	init: function(aHandler, aThreadURL, aBoardURL, aType){
		this._handler = aHandler;

		this._aboneManager = Cc["@mozilla.org/b2r-abone-manager;1"]
					.getService(Ci.b2rIAboneManager);

		this._chainAboneNumbers = new Array();
		this._enableChainAbone = ChaikaCore.pref.getBool("thread_chain_abone");

			// HTML ヘッダを送信したら true になる
		this._headerResponded = false;
		this._opend = true;
		this.httpChannel = null;

		try{
			this.thread = new ChaikaThread(aThreadURL);
		}catch(ex){
			ChaikaCore.logger.error(ex);
			this.write("BAD URL");
			this.close();
			return;
		}

		this.converter = new b2rThreadConverter();
		try{
			this.converter.init(this, this.thread.url, this.thread.boardURL, this.thread.type);
		}catch(ex){
			if(ex == Components.results.NS_ERROR_FILE_NOT_FOUND){
				var skinName = ChaikaCore.pref.getUniChar("thread_skin");
				skinName = UniConverter.toSJIS(skinName);
				this.write("スキン ("+ skinName +") の読み込みに失敗したため、");
				this.write("設定をデフォルトスキンに戻しました。<br>ページを更新してください。");
				this.close();
				ChaikaCore.pref.setChar("thread_skin", "");
				return;
			}else {
				this.write(ex);
				this.close();
				return;
			}
		}

		/*
		this.write("<!-- \n");
		this.write("URL Options \n");
		this.write("  Ones        : " + this.optionsOnes + "\n");
		this.write("  Start       : " + this.optionsStart + "\n");
		this.write("  Last        : " + this.optionsLast + "\n");
		this.write("  End         : " + this.optionsEnd + "\n");
		this.write("  NoFirst     : " + this.optionsNoFirst + "\n");
		this.write("-->\n\n");
		*/

		this._logLineCount = 0;
			// 取得済みログの送信
		if(this.thread.datFile.exists()){
			var datLines = ChaikaCore.io.readData(this.thread.datFile).split("\n");

			this._logLineCount = datLines.length;

			if(this.optionsOnes && this.optionsOnes <= this._logLineCount){
				this._headerResponded = true;
				var title = UniConverter.toSJIS(this.thread.title);
				var header = this.converter.getHeader(title);
				this.write(header);
				this.write(this.datLineParse(datLines[this.optionsOnes-1],
								this.optionsOnes, false));
				this.write(this.converter.getFooter("log_pickup_mode"));
				this.close();
				return;

			}else if(this.optionsEnd){
				this._headerResponded = true;
				var title = UniConverter.toSJIS(this.thread.title);
				var header = this.converter.getHeader(title);
				this.write(header);

				var start = this.optionsStart ? this.optionsStart : 1;
				if(start < 1) start = 1;
				var end = this.optionsEnd;
				if(end > datLines.length) end = datLines.length;
				if(start > end) start = end;

				var content = new Array();
				for(var i=start; i<end; i++){
					content.push(this.datLineParse(datLines[i], i+1, false));
				}
				this.write(content.join("\n"));


				this.write(this.converter.getFooter("log_pickup_mode"));
				this.close();
				return;

			}else{
				if(!this.optionsNoFirst){
					this.write(this.datLineParse(datLines[0], 1, false) +"\n");
				}else if(this.thread.title){
					this._headerResponded = true;
					var title = UniConverter.toSJIS(this.thread.title);
					var header = this.converter.getHeader(title);
					this.write(header);
				}else{
					this.write(this.datLineParse(datLines[0], 1, false) +"\n");
				}

				var start = 1;
				var end = datLines.length;
				if(this.optionsLast == 0){
					this.write(this.converter.getNewMark() +"\n");
					this.datDownload();
					return;
				}else if(this.optionsLast){
					start = end - this.optionsLast;
					if(start < 1) start = 1;
				}else if(this.optionsStart){
					start = this.optionsStart - 1;
					if(start > end) start = end;
				}

				var content = new Array();
				for(var i=start; i<end; i++){
					content.push(this.datLineParse(datLines[i], i+1, false));
				}

				this.write(content.join("\n"));
				this.write(this.converter.getNewMark() +"\n");
			}
		}

		if(this.thread.maruGetted){
			this.write(this.converter.getFooter("ok"));
			this.close();
		}

		this._handler.flush();
		this.datDownload();
	},

	write: function(aString){
		this._handler.write(aString);
	},

	close: function(){
		if(this._headerResponded && this.thread){
			ChaikaCore.history.visitPage(this.thread.plainURL,
					this.thread.threadID, this.thread.title, 1);
		}
		this._opend = false;
		this._httpChannel = null;
		this._handler.close();
		this._handler = null;
	},


	htmlToText: function(aStr){
		var fromStr = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
		fromStr.data = aStr;
		try{
			var toStr = { value: null };
			var	formatConverter = Cc["@mozilla.org/widget/htmlformatconverter;1"]
									.createInstance(Ci.nsIFormatConverter);
			formatConverter.convert("text/html", fromStr, fromStr.toString().length,
										"text/unicode", toStr, {});
		}catch(e){
			return aStr;
		}
		if(toStr.value){
			toStr = toStr.value.QueryInterface(Ci.nsISupportsString);
			return toStr.toString();
		}
		return aStr;
	},


	datLineParse: function(aLine, aNumber, aNew){
		if(!aLine) return "";

		var resArray = aLine.split("<>");
		var resNumber = aNumber;
		var resName = "BROKEN";
		var resMail = "";
		var resDate = "BROKEN";
		var resID = "";
		var resBeID = "";
		var resMes	= "";

		if(resArray.length > 3){
			resName = resArray[0].replace(/<\/?b>|/g, "");
			resMail = resArray[1];
			resDate = resArray[2];
			resMes = resArray[3];
		}

		if(resDate.indexOf("<") != -1){
			resDate	= this.htmlToText(resDate);
		}

			// resDate を DATE、BeID に分割
		if(resDate.indexOf("BE:")!=-1 && resDate.match(/(.+)BE:([^ ]+)/)){
			resDate = RegExp.$1;
			resBeID = RegExp.$2;
		}
			// resDate を DATE と ID に分割
		if(resDate.indexOf("ID:")!=-1 && resDate.match(/(.+)ID:(.+)/)){
			resDate = RegExp.$1;
			resID = RegExp.$2;
		}

		/*
			// resDate に IP が含まれている場合は IP を ID として扱う
		if(resDate.match(/(.+)発信元:(.+)/)){
			resDate = RegExp.$1;
			resID = RegExp.$2;
		}
		*/

		if(resBeID){
			var regBeID = /^(\d+)/;
			if(resBeID.match(regBeID)){
				var idInfoUrl = "http://be.2ch.net/test/p.php?i=" + RegExp.$1 +
						"&u=d:" + this.thread.url.resolve("./") + aNumber;
				resBeID = resBeID.replace(regBeID, String("$1").link(idInfoUrl));
			}
		}

		if(this._aboneManager.shouldAbone(resName, resMail, resID, resMes)){
			this._chainAboneNumbers.push(aNumber);
			resName = resMail = resDate = resMes = "ABONE";
			if(aNumber>1 && ChaikaCore.pref.getBool("thread_hide_abone")){
				return "";
			}
		}

			// JSでは "\" が特殊な意味を持つため、数値文字参照に変換
		resName = resName.replace(/([^\x81-\xfc]|^)\x5C/g,"$1&#x5C;");
		resMail = resMail.replace(/([^\x81-\xfc]|^)\x5C/g,"$1&#x5C;");

		var resMailName = resName;
		if(resMail) resMailName = '<a href="mailto:' + resMail + '">' + resName + '</a>';

			// レス番リンク処理 & 連鎖あぼーん
		var regResPointer = /(?:<a .*?>)?(&gt;&gt;|&gt;)([0-9]{1,4})(\-[0-9]{1,4})?(?:<\/a>)?/g;

		var chainAboneNumbers = this._chainAboneNumbers;
		var chainAbone = false;
		resMes = resMes.replace(regResPointer, function(aStr, aP1, aP2, aP3, aOffset, aS){
			chainAbone = chainAbone || (chainAboneNumbers.indexOf(parseInt(aP2)) != -1);
			return '<a href="#res' + aP2 + '" class="resPointer">' + aP1 + aP2 + aP3 + '</a>';
		});
		if(this._enableChainAbone && chainAbone){
			this._chainAboneNumbers.push(aNumber);
			resName = resMail = resDate = resMes = "ABONE";
			if(aNumber>1 && ChaikaCore.pref.getBool("thread_hide_abone")){
				return "";
			}
		}

			// 通常リンク処理
		if(resMes.indexOf("ttp")!=-1){
			var regUrlLink = /(h?ttp)(s)?\:([\-_\.\!\~\*\'\(\)a-zA-Z0-9\;\/\?\:\@\&\=\+\$\,\%\#]+)/g;
			resMes = resMes.replace(regUrlLink, '<a href="http$2:$3" class="outLink">$1$2:$3</a>');
		}

			// 通常リンク処理
		if(resMes.indexOf("sssp://")!=-1){
			var regUrlLink = /sssp:\/\/img\.2ch\.net\/ico\/(\S+\.gif)/g;
			resMes = resMes.replace(regUrlLink,
						'<img src="http://img.2ch.net/ico/$1" class="beIcon" alt="">');
		}

			// レスID
		var regResID = / (ID:)([0-9a-z\+\/]+)/ig;
		resMes = resMes.replace(regResID, ' <span class="resMesID"><span class="mesID_$2">$1$2</span></span>');

			// スレッドのタイトルが見つかったときは HTML ヘッダを追加して送る
		if(!this._headerResponded && resArray[4]){
			this._headerResponded = true;
			var title = resArray[4];
			this.thread.title = UniConverter.fromSJIS(title);

			var header = this.converter.getHeader(title);
			this.write(header);
			this._handler.flush();
		}
		var response = this.converter.getResponse(aNew, aNumber, resName, resMail,
								resMailName, resDate, resID, resBeID, resMes);
		return response;
	},


	datDownload: function(aKako){
		if(aKako){
			var bbs2chService = Cc["@mozilla.org/bbs2ch-service;1"]
					.getService(Ci.nsIBbs2chService);
			if(bbs2chService.maruLogined){
				var sid = encodeURIComponent(bbs2chService.maruSessionID);
				var datURLSpec = this.thread.plainURL.spec.replace(/\/read\.cgi\//, "/offlaw.cgi/");
				datURLSpec += "?raw=.0&sid=" + sid;
				var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
				var datKakoURL = ioService.newURI(datURLSpec, null, null).QueryInterface(Ci.nsIURL);
				this.httpChannel = ChaikaCore.getHttpChannel(datKakoURL);
				this._maruMode = true;
			}else{
				this.httpChannel = ChaikaCore.getHttpChannel(this.thread.datKakoURL);
			}
			this._kakoDatDownload = true;

		}else{
			this.httpChannel = ChaikaCore.getHttpChannel(this.thread.datURL);
			this._kakoDatDownload = false;
		}
		this.httpChannel.requestMethod = "GET";
		this.httpChannel.redirectionLimit = 0; // 302 等のリダイレクトを行わない
		this.httpChannel.loadFlags = this.httpChannel.LOAD_BYPASS_CACHE;
		this._aboneChecked = true;
		this._threadAbone = false;

			// 差分GET
		if(this.thread.datFile.exists() && this.thread.lastModified){
			var lastModified = this.thread.lastModified;
			var range = this.thread.datFile.fileSize - 1;
			this.httpChannel.setRequestHeader("Accept-Encoding", "", false);
			this.httpChannel.setRequestHeader("If-Modified-Since", lastModified, false);
			this.httpChannel.setRequestHeader("Range", "bytes=" + range + "-", false);
			this._aboneChecked = false;
		}else{
			this.httpChannel.setRequestHeader("Accept-Encoding", "gzip", false);
		}

		this.httpChannel.asyncOpen(this, null);
	},

	onStartRequest: function(aRequest, aContext){
		this._bInputStream = Cc["@mozilla.org/binaryinputstream;1"]
					.createInstance(Ci.nsIBinaryInputStream);
		this._data = new Array();
		this._datBuffer = "";
	},

	onDataAvailable: function (aRequest, aContext, aInputStream, aOffset, aCount){
		if(!this._opend) return;

		aRequest.QueryInterface(Ci.nsIHttpChannel);
		var httpStatus = aRequest.responseStatus;
			// 必要な情報がないなら終了
		if(!(httpStatus==200 || httpStatus==206)) return;
		if(aCount == 0) return;

		this._bInputStream.setInputStream(aInputStream);

		var availableData = "";
		if(!this._aboneChecked){
			var firstChar = this._bInputStream.readBytes(1)
			availableData = this._bInputStream.readBytes(aCount - 1);
			if(firstChar.charCodeAt(0) != 10){
				this._threadAbone = true;
			}

		}else{
			availableData = this._bInputStream.readBytes(aCount);
		}
		this._aboneChecked = true;


		if(this._maruMode && this._data.length == 0){
			if(availableData.match(/\n/)){
				availableData = RegExp.rightContext;
			}else{
				return;
			}
		}

			// NULL 文字
		availableData = availableData.replace(/\x00/g, "*");
			// 変換前の DAT を保存しておく
		this._data.push(availableData);

		var availableData = this._datBuffer + availableData;
			// 改行を含まないならバッファに追加して終了
		if(!availableData.match(/\n/)){
			this._datBuffer = availableData;
			return;
		}

			// 取得した DAT を行ごとに配列にし、最後の行をバッファに追加
		var datLines = availableData.split("\n");
		this._datBuffer = (datLines.length>1) ? datLines.pop() : "";

			// DAT を 変換して書き出す
		for(var i=0; i<datLines.length; i++){
			this.thread.lineCount++;
			datLines[i] = this.datLineParse(datLines[i], this.thread.lineCount, true);
		}
		this.write(datLines.join("\n"));
	},

	onStopRequest: function(aRequest, aContext, aStatus){
		if(!this._opend) return;

		this._bInputStream = null;
		aRequest.QueryInterface(Ci.nsIHttpChannel);
		try{
			var httpStatus = aRequest.responseStatus;
		}catch(ex){
			this.write(this.converter.getFooter("network_error"));
			this.close();
			return;
		}

		try{
			this.thread.lastModified = aRequest.getResponseHeader("Last-Modified");
		}catch(ex){}

		switch(httpStatus){
			case 200: // 通常GET OK
			case 206: // 差分GET OK
				break;
			case 302: // DAT落ち
				if(this._kakoDatDownload){
					this.write(this.converter.getFooter("dat_down"));
					this.close();
				}else{
					this.datDownload(true);
				}
				return;
			case 304: // 未更新
				this.write(this.converter.getFooter("not_modified"));
				this.close();
				return;
			case 416: //あぼーん
				this.write(this.converter.getFooter("abone"));
				this.close();
				return;
			default: // HTTP エラー
				this.write(this.converter.getFooter(httpStatus));
				this.close();
				return;
		}

		if(this._threadAbone){ //あぼーん
			this.write(this.converter.getFooter("abone"));
			this.close();
			return;
		}

			// XXX TODO 一部互換スクリプトには、未更新でも 206 を返すものがある?
		var newResLength = this.thread.lineCount - this._logLineCount;
		if(newResLength == 0){
			this.write(this.converter.getFooter("not_modified"));
			this.close();
			return;
		}

		if(this._datBuffer){
			this.thread.lineCount++;
			this._datBuffer = this.thread.lineCount +"\t: "+ this._datBuffer;
			this.write(this._datBuffer);
			this._datBuffer = "";
		}

		if(httpStatus == 200 || httpStatus == 206){
			this.datSave(this._data.join(""));
		}
		this.write(this.converter.getFooter("ok"));
		this.close();
		this._data = null;
	},

	datSave: function(aDatContent){
				// 書き込みのバッティングを避ける
		var tmpLineCount = 0;
		try{
			var thread = new ChaikaThread(this.thread.url);
			tmpLineCount = thread.lineCount;
		}catch(ex){}

		if(this.thread.lineCount > tmpLineCount){
				// .dat の追記書き込み
			this.thread.appendContent(aDatContent);

			if(this._maruMode) this.thread.maruGetted = true;
			this.thread.setThreadData();
		}

	}

};


// ***** ***** ***** ***** ***** b2rThreadJbbs ***** ***** ***** ***** *****
function b2rThreadJbbs(){
}

b2rThreadJbbs.prototype = {
	datDownload: function(){
		var datURLSpec = this.thread.url.resolve("./").replace("read.cgi", "rawmode.cgi");
		this._aboneChecked = true;
		this._threadAbone = false;

			// 差分GET
		if(this.thread.datFile.exists() && this.thread.lineCount){
			datURLSpec += (this.thread.lineCount + 1) + "-";
		}

		var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
		var datURL = ioService.newURI(datURLSpec, null, null).QueryInterface(Ci.nsIURL);

		this.httpChannel = ChaikaCore.getHttpChannel(datURL);
		this.httpChannel.requestMethod = "GET";
		this.httpChannel.redirectionLimit = 0; // 302 等のリダイレクトを行わない
		this.httpChannel.loadFlags = this.httpChannel.LOAD_BYPASS_CACHE;

		this.httpChannel.asyncOpen(this, null);
	},

	datLineParse: function(aLine, aNumber, aNew){
		if(!aLine) return "";

			// EUC-JP から SJIS へ変換
		var line = UniConverter.fromEUC(aLine);
		line = UniConverter.toSJIS(line);
		var resArray = line.split("<>");
		var resNumber = aNumber;
		var resName = "BROKEN";
		var resMail = "";
		var resDate = "BROKEN";
		var resID = "";
		var resBeID = "";
		var resMes	= "";

		if(resArray.length > 5){
			resName = resArray[1].replace(/<\/?b>|/g, "");
			resMail = resArray[2];
			resDate = resArray[3];
			resMes = resArray[4];
			resID = resArray[6];
		}

		if(this._aboneManager.shouldAbone(resName, resMail, resID, resMes)){
			resName = resMail = resDate = resMes = "ABONE";
			if(aNumber>1 && ChaikaCore.pref.getBool("thread_hide_abone")){
				return "";
			}
		}

			// JSでは "\" が特殊な意味を持つため、数値文字参照に変換
		resName = resName.replace(/([^\x81-\xfc]|^)\x5C/g,"$1&#x5C;");
		resMail = resMail.replace(/([^\x81-\xfc]|^)\x5C/g,"$1&#x5C;");

		var resMailName = resName;
		if(resMail) resMailName = '<a href="mailto:' + resMail + '">' + resName + '</a>';


			// レス番リンク処理 & 連鎖あぼーん
		var regResPointer = /(?:<a .*?>)?(&gt;&gt;|&gt;)([0-9]{1,4})(\-[0-9]{1,4})?(?:<\/a>)?/g;

		var chainAboneNumbers = this._chainAboneNumbers;
		var chainAbone = false;
		resMes = resMes.replace(regResPointer, function(aStr, aP1, aP2, aP3, aOffset, aS){
			chainAbone = chainAbone || (chainAboneNumbers.indexOf(parseInt(aP2)) != -1);
			return '<a href="#res' + aP2 + '" class="resPointer">' + aP1 + aP2 + aP3 + '</a>';
		});
		if(this._enableChainAbone && chainAbone){
			this._chainAboneNumbers.push(aNumber);
			resName = resMail = resDate = resMes = "ABONE";
			if(aNumber>1 && ChaikaCore.pref.getBool("thread_hide_abone")){
				return "";
			}
		}

			// 通常リンク処理
		if(resMes.indexOf("ttp")!=-1){
			var regUrlLink = /(h?ttp)(s)?\:([\-_\.\!\~\*\'\(\)a-zA-Z0-9\;\/\?\:\@\&\=\+\$\,\%\#]+)/g;
			resMes = resMes.replace(regUrlLink, '<a href="http$2:$3" class="outLink">$1$2:$3</a>');
		}

			// スレッドのタイトルが見つかったときは HTML ヘッダを追加して送る
		if(!this._headerResponded && resArray[5]!= ""){
			this._headerResponded = true;
			var title = resArray[5];
			this.thread.title = UniConverter.fromSJIS(title);
			var header = this.converter.getHeader(title);
			this.write(header);
			this._handler.flush();
		}
		var response = this.converter.getResponse(aNew, aNumber, resName, resMail,
								resMailName, resDate, resID, resBeID, resMes);
		return response;
	},

	onStopRequest: function(aRequest, aContext, aStatus){
		if(!this._opend) return;

		aRequest.QueryInterface(Ci.nsIHttpChannel);
		var httpStatus = aRequest.responseStatus;
		var jbbsError = "";
		try{
			jbbsError = aRequest.getResponseHeader("ERROR");
		}catch(ex){}


		switch(jbbsError){
			case "BBS NOT FOUND":
			case "KEY NOT FOUND":
			case "THREAD NOT FOUND":
				this.write(this.converter.getFooter(999));
				this.close();
				return;
			case "STORAGE IN":
				this.write(this.converter.getFooter("dat_down"));
				this.close();
				return;
		}

		if(this._datBuffer){
			this.thread.lineCount++;
			this._datBuffer = this.thread.lineCount +"\t: "+ this._datBuffer;
			this.write(this._datBuffer);
			this._datBuffer = "";
		}

		if(httpStatus == 200 || httpStatus == 206){
			this.datSave(this._data.join(""));
		}
		this.write(this.converter.getFooter("ok"));
		this.close();
		this._data = null;
	}
};

b2rThreadJbbs.prototype.__proto__ = b2rThread2ch.prototype;


// ***** ***** ***** ***** ***** b2rThreadMachi ***** ***** ***** ***** *****
function b2rThreadMachi(){
}

b2rThreadMachi.prototype = {
	datDownload: function(){
		var datURLSpec = this.thread.url.resolve("./").replace("read.cgi", "offlaw.cgi");
		this._aboneChecked = true;
		this._threadAbone = false;

				// 差分GET
		if(this.thread.datFile.exists() && this.thread.lineCount){
			datURLSpec += (this.thread.lineCount + 1) + "-";
		}
		var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
		var datURL = ioService.newURI(datURLSpec, null, null).QueryInterface(Ci.nsIURL);

		this.httpChannel = ChaikaCore.getHttpChannel(datURL);
		this.httpChannel.requestMethod = "GET";
		this.httpChannel.redirectionLimit = 0; // 302 等のリダイレクトを行わない
		this.httpChannel.loadFlags = this.httpChannel.LOAD_BYPASS_CACHE;

		this.httpChannel.asyncOpen(this, null);
	},

	datLineParse: function(aLine, aNumber, aNew){
		var resArray = aLine.split("<>");
		var trueNumber = parseInt(resArray.shift());
		var superClass = b2rThread2ch.prototype.datLineParse;
		return superClass.apply(this, [resArray.join("<>"), trueNumber, aNew]);
 	},


 	datSave: function(aDatContent){
		if(aDatContent){
				// サーバ側透明あぼーんにより DAT 行数と最終レスナンバーが
				// 一致しないことがあるため、行数を最終レスのナンバーから取得
			var lines = aDatContent.split("\n");
			var lastLine = lines.pop(); // 多分空行
			if(!lastLine) lastLine = lines.pop();
			this.thread.lineCount = parseInt(lastLine.match(/^\d+/));
		}
		var superClass = b2rThread2ch.prototype.datSave;
		return superClass.apply(this, arguments);
	}

};

b2rThreadMachi.prototype.__proto__ = b2rThread2ch.prototype;




// ***** ***** ***** ***** ***** b2rId2Color ***** ***** ***** ***** *****
/**
 * idから色を返します。
 */
function b2rId2Color(){
}

b2rId2Color.prototype = {
	_char64To8: new Array(),
	_cache: new Array(),
	_bgcache: new Array(),

	init: function(){
		var idChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
		var i=0;
		for(var m in idChars){
			this._char64To8[idChars[m]]=i
			if(((parseInt(m)+1)%8)==0) i++;
		}
	},

	/**
	 * idからCSSの色を返します。
	 *
	 * @param aID {string} 2chのID
	 * @param aIsBackground {bool} 背景か
	 * @type string
	 * @return CSSの色
	 */
	getColor: function(aID, aIsBackground){
		if(aID.length < 8) return "inherit";

		aID = aID.substring(0,8);
		var cache = (aIsBackground) ? this._bgcache : this._cache;

		if(!(aID in cache)){
			var newint = 0;
			for each(var s in aID){
				newint <<= 3;
				newint |= this._char64To8[s];
			}
			// hsl(0-360,0-100%,0-100%);
			var h = newint%360;
			newint = Math.floor(newint/360);
			var s = newint%100;
			newint = Math.floor(newint/100);
			var l;
			if(aIsBackground)
				l = newint % 20 + 80;
			else
				l = newint%60;
			cache[aID] = "hsl("+ h +","+ s +"%,"+ l +"%)";
		}
		return cache[aID];
	}
}


// ***** ***** ***** ***** ***** b2rThreadConverter ***** ***** ***** ***** *****
function b2rThreadConverter(){
}

b2rThreadConverter.prototype = {

	init: function(aContext, aThreadURL, aBoardURL, aType){
		this._context = aContext;
		this._threadURL = aThreadURL;
		this._boardURL = aBoardURL;
		this._type = aType;

		this._dd2Color = new b2rId2Color();
		this._dd2Color.init();

		try{
			this._tmpHeader   = ChaikaCore.io.readData(this._resolveSkinFile("Header.html"));
			this._tmpFooter   = ChaikaCore.io.readData(this._resolveSkinFile("Footer.html"));
			this._tmpRes	  = ChaikaCore.io.readData(this._resolveSkinFile("Res.html"));
			this._tmpNewRes	  = ChaikaCore.io.readData(this._resolveSkinFile("NewRes.html"));
			this._tmpNewMark  = ChaikaCore.io.readData(this._resolveSkinFile("NewMark.html"));
		}catch(ex){
			ChaikaCore.logger.error(ex);
			throw Components.results.NS_ERROR_FILE_NOT_FOUND;
		}

			// 基本スキンタグの置換
		this._tmpHeader = this._replaceBaseTag(this._tmpHeader);
		this._tmpFooter = this._replaceBaseTag(this._tmpFooter);
		this._tmpRes = this._replaceBaseTag(this._tmpRes);
		this._tmpNewRes = this._replaceBaseTag(this._tmpNewRes);
		this._tmpNewMark = this._replaceBaseTag(this._tmpNewMark);

		this._tmpGetRes = this.toFunction(this._tmpRes);
		this._tmpGetNewRes = this.toFunction(this._tmpNewRes);

				// 旧仕様の互換性確保
		if(!this._tmpFooter.match(/<STATUS\/>/)){
			this._tmpFooter = '<p class="info"><STATUS/></p>\n' + this._tmpFooter;
		}
	},

	_resolveSkinFile: function(aFilePath){
		var skinName = ChaikaCore.pref.getUniChar("thread_skin");

		var skinFile = null;
		if(skinName){
			skinFile = ChaikaCore.getDataDir();
			skinFile.appendRelativePath("skin");
			skinFile.appendRelativePath(skinName);
		}else{
			skinFile = ChaikaCore.getDefaultsDir();
			skinFile.appendRelativePath("skin");
		}
		skinFile.appendRelativePath(aFilePath);
		return skinFile;
	},

	/**
	 * 基本スキンタグの置換
	 * @param aString string 置換される文字列
	 */
	_replaceBaseTag: function(aString){
		var requestURL = this._context._handler.requestURL;
		var threadURLSpec = requestURL.path.substring(8);
		var skinURISpec = ChaikaCore.getServerURL().resolve("./skin/");
		var serverURLSpec = ChaikaCore.getServerURL().resolve("./thread/");
		var fontName = ChaikaCore.pref.getUniChar("thread_font_name");
		fontName = UniConverter.toSJIS(fontName);
		var fontSize = ChaikaCore.pref.getInt("thread_font_size");
		var aaFontName = ChaikaCore.pref.getUniChar("thread_aa_font_name");
		aaFontName = UniConverter.toSJIS(aaFontName);
		var aaFontSize = ChaikaCore.pref.getInt("thread_aa_font_size");

		return aString.replace(/<SKINPATH\/>/g, skinURISpec)
				.replace(/<THREADURL\/>/g, this._threadURL.resolve("./"))
				.replace(/<BOARDURL\/>/g, this._boardURL.spec)
				.replace(/<SERVERURL\/>/g, serverURLSpec)
				.replace(/<FONTNAME\/>/g, "\'" + fontName + "\'")
				.replace(/<FONTSIZE\/>/g, fontSize + "px")
				.replace(/<AAFONTNAME\/>/g, "\'" + aaFontName + "\'")
				.replace(/<AAFONTSIZE\/>/g, aaFontSize + "px");
	},

	getHeader: function(aTitle){
		return this._tmpHeader.replace(/<THREADNAME\/>/g, aTitle);
	},

	getFooter: function(aStatusText){
		var datSize = 0;
		var datSizeKB = 0;
		var datFile = this._context.thread.datFile.clone();
		if(datFile.exists()){
			datSize = datFile.fileSize;
			datSizeKB = Math.round(datSize / 1024);
		}
		var logLineCount = this._context._logLineCount;
		var lineCount = this._context.thread.lineCount;

		return this._tmpFooter.replace(/<STATUS\/>/g, this.getStatusText(aStatusText))
					.replace(/<SIZE\/>/g, datSize)
					.replace(/<SIZEKB\/>/g, datSizeKB)
					.replace(/<GETRESCOUNT\/>/g, logLineCount)
					.replace(/<NEWRESCOUNT\/>/g, lineCount - logLineCount)
					.replace(/<ALLRESCOUNT\/>/g, lineCount);
	},

	getStatusText: function(aStatus){
	    var strBundleService = Cc["@mozilla.org/intl/stringbundle;1"]
                                      .getService(Ci.nsIStringBundleService);
		var statusBundle = strBundleService.createBundle(
								"chrome://chaika/content/server/thread-status.properties");
		var statusText = "";
		if(typeof(aStatus) == "string"){
			try{
				statusText = statusBundle.GetStringFromName(aStatus);
			}catch(ex){}
		}else{
			try{
				statusText = statusBundle.formatStringFromName("error", [String(aStatus)], 1);
			}catch(ex){}
		}
		return UniConverter.toSJIS(statusText);
	},

	getNewMark: function(){
		return this._tmpNewMark;
	},

	toFunction: function(aRes){
		return eval(
			"function(aNumber, aName, aMail, aMailName, aDate, aID, resIDColor, resIDBgColor, aBeID, aMessage){return \""+aRes
				.replace(/\\/g,"\\\\").replace(/\"/g,"\\\"")
				.replace(/(\r|\n|\t)/g,"").replace(/<!--.*?-->/g,"")
				.replace(/<PLAINNUMBER\/>/g, "\"+aNumber+\"")
				.replace(/<NUMBER\/>/g, "\"+aNumber+\"")
				.replace(/<NAME\/>/g, "\"+aName+\"")
				.replace(/<MAIL\/>/g, "\"+aMail+\"")
				.replace(/<MAILNAME\/>/g, "\"+aMailName+\"")
				.replace(/<DATE\/>/g, "\"+aDate+\"")
				.replace(/<ID\/>/g, "\"+aID+\"")
				.replace(/<IDCOLOR\/>/g, "\"+resIDColor+\"")
				.replace(/<IDBACKGROUNDCOLOR\/>/g, "\"+resIDBgColor+\"")
				.replace(/<BEID\/>/g, "\"+aBeID+\"")
				.replace(/<MESSAGE\/>/g, "\"+aMessage+\"")+"\";}"
		);
	},

	getResponse: function(aNew, aNumber, aName, aMail, aMailName, aDate, aID, aBeID, aMessage){
		var template = aNew ? this._tmpNewRes : this._tmpRes;
		if(!template.match(/<ID\/>/))
			aDate = aDate + " ID:" + aID;
		if(!template.match(/<BEID\/>/))
			aDate = aDate + " Be:" + aBeID;

		var resIDColor = (template.search(/<IDCOLOR\/>/) != -1) ?
				this._dd2Color.getColor(aID, false) : "inherit";
		var resIDBgColor = (template.search(/<IDBACKGROUNDCOLOR\/>/) != -1) ?
				this._dd2Color.getColor(aID, true) : "inherit";

		if(this.isAA(aMessage)){
			aMessage = '<span class="aaRes">' + aMessage + '</span>';
		}

		var result;
		if(aNew){
			result = this._tmpGetNewRes(aNumber, aName, aMail, aMailName, aDate, aID,
						resIDColor, resIDBgColor,aBeID, aMessage);
		}else{
			result = this._tmpGetRes(aNumber, aName, aMail, aMailName, aDate, aID,
						resIDColor, resIDBgColor,aBeID, aMessage);
		}
		return result;
	},

	isAA: function(aMessage) {
		var lineCount = aMessage.match(/<br>/g);
		if(lineCount && lineCount.length >= 3){
			var spaceCount = aMessage.match(/[ 　\.:i\|]/g);
			if(spaceCount && (spaceCount.length / aMessage.length) >= 0.3){
				return true;
			}
		}
		return false;
	}

};
