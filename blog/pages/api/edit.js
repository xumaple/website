import db from '../../firebase/model.ts';


export default (req, res) => {
  let ref = db.ref('projects/-MyNaUrs8I2gv1Fu5o3n/posts');
  ref.push({filename: 'raw.20210913.md'})


  res.status(200).json({ name: 'John Doe' })
}
