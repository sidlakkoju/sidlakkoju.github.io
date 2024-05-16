import React from 'react';

interface ProjectCardProps {
  title: string;
  description: string;
  mediaUrl: string;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ title, description, mediaUrl }) => {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
      <div className="w-full h-72 overflow-hidden rounded-t-lg">
        <video src={mediaUrl} className="w-full h-full object-cover" autoPlay loop muted playsInline />
      </div>
      <div className="p-4">
        <h3 className="text-xl font-semibold mb-2 text-black dark:text-white">{title}</h3>
        <p className="text-gray-700 dark:text-gray-300">{description}</p>
      </div>
    </div>
  );
};

export default ProjectCard;
