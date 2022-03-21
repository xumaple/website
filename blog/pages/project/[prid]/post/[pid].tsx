// import { get, child } from 'firebase/database';
import db from '../../../../firebase/model.ts';
import Markdown from 'react-markdown';
import { POST_FILENAME_C, PROJ_LIST_C, POST_LIST_C } from '../../../../consts.ts';
import readPostFile from './readPostFile';
import { privateEncrypt } from 'crypto';

export async function getStaticPaths() {
  let paths = [].concat.apply([], 
    (await db.getChildrenKeyVals(PROJ_LIST_C, 'order')).map(({key, val}) => 
      Object.entries(val[POST_LIST_C]).map(([pid, _]) => (
        {params: {prid: key, pid}}
      ))
    )
  );
  return { paths, fallback: false }
}

export async function getStaticProps(context) {
  let post = (await db.ref(PROJ_LIST_C).child(context.params.prid).child(POST_LIST_C).child(context.params.pid).once('value')).val();

  post.text = await readPostFile(post.filename);

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