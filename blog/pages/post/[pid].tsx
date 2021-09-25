import fs from 'fs';
import path from 'path';
// import { get, child } from 'firebase/database';
import db from '../../firebase/model.ts';
import Markdown from 'react-markdown';
import { POST_FILENAME_C } from '../../const.ts';

const firebase_prefix = '-Mjtp';

export async function getStaticPaths() {
  return { paths: [], fallback: true }
}

export async function getStaticProps(context) {
  let ref = db.ref('test');
  ref.once("value", s=>{console.log(s.val())})

  let post = (await db.ref('posts').child(firebase_prefix+context.params.pid).once('value')).val()
  console.log("**", post);

  post.text = await fs.readFileSync(path.join(process.cwd(), "data/posts/"+post.filename)).toString()
  console.log('generating...');

  return {props: post };
}

export default function Post(props) {
  const { filename, text } = props;
  // console.log(db.ref('test'));
  // console.log(text);

  return <p>This is the pid for file {props[POST_FILENAME_C]} in the url: 
    <Markdown transformImageUri={uri =>
      uri.startsWith("pictures") ? uri : `data/posts/${uri}`
    }>
      {text}
    </Markdown>
  </p>
}