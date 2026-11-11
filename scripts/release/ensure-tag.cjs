// Manual publications build on main so future releases can restore default-branch caches.
// Create the tag with this workflow's GITHUB_TOKEN: GitHub does not enqueue a duplicate tag build.
const {spawnSync}=require('node:child_process');
const {VERSION}=require('./check-version.cjs');
const version=require('../../package.json').version;
const repository=process.env.GITHUB_REPOSITORY,commit=process.env.GITHUB_SHA,tag=process.env.RELEASE_TAG;
function gh(args,allowMissing=false){
 const result=spawnSync('gh',args,{encoding:'utf8',env:{...process.env,GH_HOST:'github.com',GH_REPO:repository}});
 if(result.status===0)return JSON.parse(result.stdout);
 if(allowMissing&&/HTTP 404/.test(result.stderr||''))return null;
 const token=process.env.GH_TOKEN,detail=(result.stderr||result.error?.message||'GitHub tag verification failed').slice(0,2000);
 throw Error(token?detail.split(token).join('[redacted]'):detail);
}
try{
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||!/^[a-f0-9]{40}$/.test(commit)||!VERSION.test(version)||tag!=='v'+version)throw Error('Invalid version tag or source context');
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
 if(head.status!==0||head.stdout.trim()!==commit)throw Error('The checked-out source differs from the built workflow commit');
 const endpoint='repos/'+repository+'/git/ref/tags/'+encodeURIComponent(tag);
 let ref=gh(['api',endpoint],true);
 if(!ref){
  if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Only an explicit publication on main may create a missing version tag');
  ref=gh(['api','repos/'+repository+'/git/refs','--method','POST','--raw-field','ref=refs/tags/'+tag,'--raw-field','sha='+commit]);
 }
 let object=ref.object;
 for(let n=0;object?.type==='tag'&&n<8;n++)object=gh(['api','repos/'+repository+'/git/tags/'+object.sha]).object;
 if(object?.type!=='commit'||object.sha!==commit)throw Error('The version tag points to a different source commit');
 console.log('Version tag verified: '+tag+' at '+commit);
}catch(error){console.error(error.message);process.exitCode=1;}
